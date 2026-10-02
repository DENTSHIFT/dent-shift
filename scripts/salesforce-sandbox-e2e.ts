/**
 * Salesforce Sandboxでの結合検証(実際のSalesforce APIに対して、DENT SHIFTの同期コードをそのまま実行する)。
 *
 * 安全装置:
 *   - 接続先のMy DomainがSandbox命名規則(`--<sandbox名>.sandbox.`)でなければ、何も書き込まずに
 *     終了する(連携専用ユーザーの最小権限ではOrganizationオブジェクトを読めないため、
 *     Organization.IsSandboxではなくMy Domainの命名規則で判定する)。
 *   - SALESFORCE_EXPECTED_ORG_ID と実際の組織IDが一致しなければ終了する(同期コード側でも照合、
 *     こちらが本番取り違え防止の主たる安全装置)。
 *   - DENT SHIFT側のDBは一時SQLite(全マイグレーション適用)を使い、開発・本番DBには触れない。
 *   - 検証データは名前に「【検証】」を付け、メールは予約済みドメイン(example.com)のみ。
 *
 * 使い方(Sandboxの接続情報は .env ではなく専用ファイルで渡す。リポジトリには含めない):
 *   set -a; source salesforce/.env.sandbox; set +a
 *   npx tsx --conditions=react-server scripts/salesforce-sandbox-e2e.ts
 *   npx tsx --conditions=react-server scripts/salesforce-sandbox-e2e.ts --cleanup <runId>   # 検証データの削除(Sandboxのみ)
 *
 * 出力: 各検証の合否と、画面確認用のSalesforceレコードID(検証データのみ)。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPrismaMigrationsToTestDatabase } from "../tests/helpers/testDatabase";

const API = "v60.0";
const runId = process.argv.includes("--cleanup")
  ? process.argv[process.argv.indexOf("--cleanup") + 1]!
  : `e2e${Date.now().toString(36)}`;

type Check = { step: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(step: string, ok: boolean, detail: string) {
  checks.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`);
}

async function salesforceSession(clientId = process.env.SALESFORCE_CLIENT_ID!, clientSecret = process.env.SALESFORCE_CLIENT_SECRET!) {
  const loginUrl = new URL(process.env.SALESFORCE_LOGIN_URL!).origin;
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`OAuth failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; instance_url: string; id: string };
  const orgId = body.id.split("/id/")[1]!.split("/")[0]!;
  const call = async (pathname: string, init: RequestInit = {}) => {
    const r = await fetch(`${body.instance_url}/services/data/${API}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${body.access_token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!r.ok && r.status !== 404) throw new Error(`${init.method ?? "GET"} ${pathname}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 || r.status === 404 ? null : r.json();
  };
  const soql = async <T = Record<string, unknown>>(q: string): Promise<T[]> =>
    ((await call(`/query?q=${encodeURIComponent(q)}`)) as { records: T[] }).records;
  const executeAnonymous = async (apex: string) => {
    const json = (await call(`/tooling/executeAnonymous?anonymousBody=${encodeURIComponent(apex)}`)) as {
      compiled: boolean;
      success: boolean;
      compileProblem?: string;
      exceptionMessage?: string;
    };
    if (!json.compiled || !json.success) {
      throw new Error(`Apex failed: compiled=${json.compiled} success=${json.success} compileProblem=${json.compileProblem} exceptionMessage=${json.exceptionMessage}`);
    }
    return json;
  };
  return { orgId, instanceUrl: body.instance_url, call, soql, executeAnonymous };
}

async function main() {
  for (const name of ["SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET", "SALESFORCE_LOGIN_URL", "SALESFORCE_EXPECTED_ORG_ID"]) {
    if (!process.env[name]) throw new Error(`${name} が必要です(salesforce/.env.sandbox から読み込む)`);
  }
  const sf = await salesforceSession();
  // 注意: 当初は `SELECT IsSandbox FROM Organization` で確認していたが、連携専用ユーザー
  // (Salesforce Integration License, 最小権限)の実行コンテキストではOrganizationオブジェクト
  // 自体が「サポートされていない型」としてアクセス不可(INVALID_TYPE)になることを確認した。
  // Organizationオブジェクトへの読み取り権限を連携ユーザーへ追加で付与する案もあったが、
  // 連携ユーザーの権限は最小限に保つ設計(PO指示)のため見送り、代わりにSalesforceの
  // SandboxのMy Domainが必ず `--<sandbox名>.sandbox.` を含むという確定的な命名規則で判定する。
  // 本番との取り違え防止の実体はSALESFORCE_EXPECTED_ORG_IDの完全一致チェック(直後)であり、
  // こちらが主たる安全装置であることに変わりはない。
  const loginHost = new URL(process.env.SALESFORCE_LOGIN_URL!).host;
  const isSandboxHost = /--[^.]+\.sandbox\./.test(loginHost);
  if (!isSandboxHost) throw new Error("接続先がSandboxではありません(My DomainがSandbox命名規則と一致しません)。本番組織では実行しません。");
  if (sf.orgId.slice(0, 15) !== process.env.SALESFORCE_EXPECTED_ORG_ID!.slice(0, 15)) {
    throw new Error("接続先の組織IDが SALESFORCE_EXPECTED_ORG_ID と一致しません。");
  }

  if (process.argv.includes("--cleanup")) return cleanup(sf, runId);

  // DENT SHIFT側は一時DB。Salesforce同期を有効にし、TimeRexの医院参照の署名鍵も検証用に設定する。
  const dbDir = mkdtempSync(path.join(tmpdir(), "dentshift-sf-e2e-"));
  process.env.DATABASE_URL = `file:${path.join(dbDir, "e2e.db")}`;
  process.env.SALESFORCE_PROVIDER = "salesforce";
  process.env.TIMEREX_BOOKING_REF_SECRET = `e2e-${runId}`;
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || "https://test.dentshift.jp";
  delete process.env.SALESFORCE_ALERT_EMAIL; // 検証中の失敗通知メールは送らない
  applyPrismaMigrationsToTestDatabase(path.join(dbDir, "e2e.db"));

  const { prisma } = await import("@/server/db/prismaClient");
  const { enqueueIntegrationEvent } = await import("@/server/db/integrationEventRepository");
  const { syncIntegrationEvent, retryPendingIntegrationEvents } = await import("@/server/services/salesforceSync");
  const { applyBillingWebhookEvent } = await import("@/server/db/billingRepository");
  const { applyTimeRexBooking } = await import("@/server/services/timerexBookings");
  const { createBookingRef } = await import("@/server/integration/bookingRef");

  const flush = async () => {
    // 送信待ちを全件送る(再試行時刻を待たない)。
    await prisma.integrationEvent.updateMany({ where: { status: { in: ["pending", "failed"] } }, data: { nextRetryAt: null } });
    await retryPendingIntegrationEvents(100);
  };
  const one = async <T = Record<string, unknown>>(q: string) => sf.soql<T>(q);

  // --- 1. 無料診断(会員登録前) ---
  const clinic = await prisma.clinic.create({
    data: {
      name: `【検証】DENT SHIFT検証歯科 ${runId}`,
      directorName: "検証 院長",
      url: `https://${runId}.example.com/`,
      contactEmail: `clinic-${runId}@example.com`,
      utmSource: "e2e",
      utmCampaign: runId,
    },
  });
  const diagnosis = await prisma.diagnosis.create({
    data: {
      clinicId: clinic.id,
      totalPoints: 48,
      totalStatus: "要改善",
      scoreBreakdownJson: "{}",
      competitorsJson: "[]",
      questionResultsJson: "[]",
      improvementTasksJson: JSON.stringify([{ title: "Web予約導線の改善" }, { title: "Googleビジネスプロフィールの更新" }]),
      dataDisclaimer: "",
      isSample: false,
    },
  });
  await prisma.aiObservation.create({
    data: {
      diagnosisId: diagnosis.id, clinicId: clinic.id, patientQuestion: "近くの歯医者", provider: "openai", model: "e2e",
      mention: false, measurementAt: diagnosis.measuredAt, capturedAt: diagnosis.measuredAt, evidence: "", sourceType: "ai_provider",
      measurementStatus: "measured", provisional: false,
    },
  });
  await enqueueIntegrationEvent({ eventType: "diagnosis_completed", clinicId: clinic.id, payload: {} });
  // Lead.DoNotCallはこの組織に存在しないため、Sandbox限定のカスタム項目
  // DentShift_Do_Not_Call__c(既定値true)を代替として使う。同期コードはこの項目に
  // 一切書き込まない(salesforceSync.ts参照)。初期値はSalesforce項目自体の
  // defaultValueに任せる設計のため、ここでは「新規作成されたLeadの既定値がtrueで
  // あること」をSandboxの実際の項目に対して確認する。
  const leads = await one<{ Id: string; DentShift_Latest_Score__c: number }>(
    `SELECT Id, DentShift_Latest_Score__c FROM Lead WHERE DentShift_Clinic_Id__c = '${clinic.id}'`
  );
  check("診断→リード作成", leads.length === 1, `リード${leads.length}件、スコア=${leads[0]?.DentShift_Latest_Score__c}`);
  const dnc1 = await one<{ DentShift_Do_Not_Call__c: boolean }>(
    `SELECT DentShift_Do_Not_Call__c FROM Lead WHERE Id = '${leads[0]?.Id}'`
  );
  check("新規リードは電話禁止が既定値(Salesforce項目のdefaultValue)", dnc1[0]?.DentShift_Do_Not_Call__c === true, `DentShift_Do_Not_Call__c=${dnc1[0]?.DentShift_Do_Not_Call__c}`);

  // 再送(同じ医院への2回目以降の同期)でも電話禁止の値を変更しないことを確認する。
  await enqueueIntegrationEvent({ eventType: "diagnosis_result_viewed", clinicId: clinic.id, payload: {} });
  const dnc2 = await one<{ DentShift_Do_Not_Call__c: boolean }>(
    `SELECT DentShift_Do_Not_Call__c FROM Lead WHERE Id = '${leads[0]?.Id}'`
  );
  check("再送でも電話禁止の値は変わらない(true)", dnc2[0]?.DentShift_Do_Not_Call__c === true, `DentShift_Do_Not_Call__c=${dnc2[0]?.DentShift_Do_Not_Call__c}`);

  // 担当者が医院の同意を得て手動で解除した後、再送しても上書きされないことを確認する。
  // 連携専用ユーザーにはこの項目の編集権限を意図的に与えていない(DentShift_Sales_Staff
  // 権限セットのみ編集可)ため、担当者操作の再現には管理者用認証(SALESFORCE_ADMIN_*)を使う。
  if (process.env.SALESFORCE_ADMIN_CLIENT_ID && process.env.SALESFORCE_ADMIN_CLIENT_SECRET) {
    const adminSf = await salesforceSession(process.env.SALESFORCE_ADMIN_CLIENT_ID, process.env.SALESFORCE_ADMIN_CLIENT_SECRET);
    await adminSf.call(`/sobjects/Lead/${leads[0]?.Id}`, {
      method: "PATCH",
      body: JSON.stringify({ DentShift_Do_Not_Call__c: false, DentShift_Do_Not_Call_Reason__c: "【検証】医院から電話OKの同意を確認(E2E)" }),
    });
    await enqueueIntegrationEvent({ eventType: "diagnosis_result_viewed", clinicId: clinic.id, payload: {} });
    const dnc3 = await one<{ DentShift_Do_Not_Call__c: boolean }>(
      `SELECT DentShift_Do_Not_Call__c FROM Lead WHERE Id = '${leads[0]?.Id}'`
    );
    check("同意後の担当者による解除は再送で上書きされない(false維持)", dnc3[0]?.DentShift_Do_Not_Call__c === false, `DentShift_Do_Not_Call__c=${dnc3[0]?.DentShift_Do_Not_Call__c}`);
  } else {
    check(
      "同意後の担当者による解除は再送で上書きされない(false維持)",
      false,
      "未検証: SALESFORCE_ADMIN_CLIENT_ID/SECRET が未設定(担当者操作の再現には管理者用認証が必要)"
    );
  }

  const diagRecords = await one(`SELECT Id FROM DentShift_Diagnosis__c WHERE DentShift_Diagnosis_Id__c = '${diagnosis.id}'`);
  check("診断履歴レコード", diagRecords.length === 1, `${diagRecords.length}件`);

  // --- 2. 相談CTAクリック(2回) ---
  for (let i = 0; i < 2; i++) {
    await enqueueIntegrationEvent({ eventType: "online_consultation_clicked", clinicId: clinic.id, payload: {} });
  }
  const [leadCta] = await one<{ DentShift_Consultation_Cta_Clicks__c: number }>(
    `SELECT DentShift_Consultation_Cta_Clicks__c FROM Lead WHERE DentShift_Clinic_Id__c = '${clinic.id}'`
  );
  check("相談CTAクリック回数", leadCta?.DentShift_Consultation_Cta_Clicks__c === 2, `回数=${leadCta?.DentShift_Consultation_Cta_Clicks__c}`);

  // --- 3. TimeRex予約(署名付き医院参照)・再通知・予約変更(取消+新規として扱う)・取消 ---
  const ref = createBookingRef(clinic.id)!;
  const booking = (id: string, start: string, type: "event_confirmed" | "event_cancelled" = "event_confirmed") => ({
    webhookType: type,
    timerexEventId: id,
    startAt: new Date(start),
    endAt: new Date(new Date(start).getTime() + 45 * 60 * 1000),
    bookedAt: new Date(),
    canceledAt: type === "event_cancelled" ? new Date() : null,
    calendarName: "検証カレンダー",
    hostName: "検証担当",
    guestEmail: `clinic-${runId}@example.com`,
    urlParams: (type === "event_confirmed" ? { ds_ref: ref } : {}) as Record<string, string>,
  });
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  await applyTimeRexBooking(booking(`${runId}-tx1`, future(7)));
  await applyTimeRexBooking(booking(`${runId}-tx1`, future(7))); // TimeRexの再送
  let consults = await one(`SELECT Id FROM DentShift_Consultation__c WHERE DentShift_Clinic_Id__c = '${clinic.id}'`);
  check("予約成立→相談予約1件(再通知で重複しない)", consults.length === 1, `${consults.length}件`);
  // 予約変更: TimeRexの通知仕様は確定・取消のみ。変更は「旧予約の取消+新予約の確定」として届く想定で検証(実挙動は要確認)
  await applyTimeRexBooking(booking(`${runId}-tx1`, future(7), "event_cancelled"));
  await applyTimeRexBooking(booking(`${runId}-tx2`, future(10)));
  await applyTimeRexBooking(booking(`${runId}-tx1`, future(7))); // 取消後に古い確定通知が遅れて届く
  const consultRows = await one<{ DentShift_TimeRex_Event_Id__c: string; DentShift_Booking_Status__c: string }>(
    `SELECT DentShift_TimeRex_Event_Id__c, DentShift_Booking_Status__c FROM DentShift_Consultation__c WHERE DentShift_Clinic_Id__c = '${clinic.id}' ORDER BY DentShift_TimeRex_Event_Id__c`
  );
  check(
    "予約変更(取消+新規)・取消後の古い通知で戻らない",
    consultRows.length === 2 && consultRows[0]?.DentShift_Booking_Status__c === "キャンセル" && consultRows[1]?.DentShift_Booking_Status__c === "予約成立",
    consultRows.map((r) => `${r.DentShift_TimeRex_Event_Id__c.replace(runId, "")}:${r.DentShift_Booking_Status__c}`).join(", ")
  );

  // --- 4. 会員登録 → 取引先・取引先責任者 ---
  const contact = await prisma.contact.create({
    data: {
      clinicId: clinic.id, email: `owner-${runId}@example.com`, passwordHash: "e2e", role: "owner",
      registrationStep: "completed", emailVerifiedAt: new Date(), phoneVerifiedAt: new Date(), consentAcceptedAt: new Date(),
    },
  });
  await enqueueIntegrationEvent({ eventType: "trial_signup_started", clinicId: clinic.id, contactId: contact.id, payload: {} });
  const accounts = await one<{ Id: string }>(`SELECT Id FROM Account WHERE DentShift_Clinic_Id__c = '${clinic.id}'`);
  const contacts = await one<{ AccountId: string }>(`SELECT AccountId FROM Contact WHERE DentShift_User_Id__c = '${contact.id}'`);
  check("登録→取引先1件・取引先責任者1件(取引先に紐づく)", accounts.length === 1 && contacts[0]?.AccountId === accounts[0]?.Id, `取引先${accounts.length}件 / 責任者${contacts.length}件`);
  const diagLinked = await one<{ DentShift_Account__c: string }>(`SELECT DentShift_Account__c FROM DentShift_Diagnosis__c WHERE DentShift_Diagnosis_Id__c = '${diagnosis.id}'`);
  // 注意: ここで確認しているのはDentShift_Diagnosis__c.DentShift_Account__c(参照項目)が
  // 正しい取引先IDを指していることのみで、取引先のページ上で実際に関連リストとして
  // 表示されるかどうかは別途ページレイアウトの設定(現状未反映、保留中)に依存する。
  // 誤解を招かないよう、詳細文言でも「データの紐づき」と「画面表示」を区別する。
  check(
    "診断履歴が取引先に紐づく(データ上の参照。画面表示はページレイアウト次第)",
    diagLinked[0]?.DentShift_Account__c === accounts[0]?.Id,
    `DentShift_Account__c=${diagLinked[0]?.DentShift_Account__c}(取引先ID=${accounts[0]?.Id}と一致)`
  );

  // --- 5. Stripe: トライアル → 有料 → 遅延した古い通知 → 解約 ---
  const sub = `sub_${runId}`;
  const stripe = (eventId: string, status: "trial" | "active" | "cancelled", at: string, extra: Record<string, unknown> = {}) =>
    applyBillingWebhookEvent({
      providerEventId: `${runId}-${eventId}`,
      eventType: "customer.subscription.updated",
      occurredAt: new Date(at),
      action: {
        kind: "subscription_status",
        identity: { externalSubscriptionId: sub, clinicId: clinic.id, plan: "standard" },
        status,
        billingPeriod: { currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelAt: null, canceledAt: null, endedAt: null, ...extra },
      },
    } as never);
  const t = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
  await stripe("e1", "trial", t(0));
  await flush();
  let [opp] = await one<{ StageName: string; DentShift_Billing_Status__c: string }>(
    `SELECT StageName, DentShift_Billing_Status__c FROM Opportunity WHERE Account.DentShift_Clinic_Id__c = '${clinic.id}'`
  );
  check("トライアル→商談(進行中)", opp?.StageName === "Qualification", `フェーズ=${opp?.StageName} / 状態=${opp?.DentShift_Billing_Status__c}`);
  await stripe("e3", "active", t(2), { currentPeriodEnd: new Date(t(24 * 30)) });
  await stripe("e2", "trial", t(1)); // 古い通知が後から届く
  await stripe("e3", "active", t(2)); // 同じ通知の再送
  await flush();
  [opp] = await one(`SELECT StageName, DentShift_Billing_Status__c FROM Opportunity WHERE Account.DentShift_Clinic_Id__c = '${clinic.id}'`);
  check("有料化→受注。古い通知・再送で戻らない", opp?.StageName === "Closed Won" && opp?.DentShift_Billing_Status__c === "active", `フェーズ=${opp?.StageName} / 状態=${opp?.DentShift_Billing_Status__c}`);
  await stripe("e4", "cancelled", t(3), { canceledAt: new Date(t(3)), endedAt: new Date(t(3)) });
  await flush();
  const opps = await one<{ StageName: string; DentShift_Billing_Status__c: string }>(
    `SELECT StageName, DentShift_Billing_Status__c FROM Opportunity WHERE Account.DentShift_Clinic_Id__c = '${clinic.id}'`
  );
  check("解約後も受注のまま・商談は1件", opps.length === 1 && opps[0]?.StageName === "Closed Won" && opps[0]?.DentShift_Billing_Status__c === "cancelled", `商談${opps.length}件 / フェーズ=${opps[0]?.StageName} / 状態=${opps[0]?.DentShift_Billing_Status__c}`);

  // --- 6. 同期失敗 → 自動再試行で回復 ---
  const realFetch = globalThis.fetch;
  let failOnce = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (failOnce && init?.method === "PATCH") {
      failOnce = false;
      throw new TypeError("simulated network failure");
    }
    return realFetch(input, init);
  }) as typeof fetch;
  await enqueueIntegrationEvent({ eventType: "diagnosis_result_viewed", clinicId: clinic.id, payload: {} });
  globalThis.fetch = realFetch;
  // この医院に対しては電話禁止の再送・同意変更の検証で同種のイベントを複数発行済みのため、
  // 最新(createdAt降順)の1件を見る(先頭の既にsynced済みイベントを誤って参照しないよう)。
  const failed = await prisma.integrationEvent.findFirstOrThrow({
    where: { eventType: "diagnosis_result_viewed", clinicId: clinic.id },
    orderBy: { createdAt: "desc" },
  });
  check("通信失敗→failed・試行1回で保留", failed.status === "failed" && failed.retryCount === 1, `状態=${failed.status} 試行=${failed.retryCount}`);
  await flush();
  const recovered = await prisma.integrationEvent.findUniqueOrThrow({ where: { id: failed.id } });
  check("再試行で同期完了", recovered.status === "synced", `状態=${recovered.status}`);

  // --- 7. 同じ医院の同時同期(ロック) ---
  const a = await prisma.integrationEvent.create({ data: { eventType: "diagnosis_result_viewed", clinicId: clinic.id, payloadJson: "{}" } });
  const b = await prisma.integrationEvent.create({ data: { eventType: "diagnosis_result_viewed", clinicId: clinic.id, payloadJson: "{}" } });
  // Promise.allSettledで両方の結果を待ち受ける(片方が何らかの理由で失敗しても、
  // もう片方の検証(ロックで待機したこと)を失わないため)。
  const settled = await Promise.allSettled([syncIntegrationEvent(a.id), syncIntegrationEvent(b.id)]);
  const outcomeLabels = settled.map((r) => (r.status === "fulfilled" ? r.value : `rejected:${(r.reason as Error).message.slice(0, 60)}`));
  check("同時同期は1件ずつ(片方は待機)", outcomeLabels.includes("busy") && outcomeLabels.includes("synced"), outcomeLabels.join(", "));
  await flush();

  // --- 8. 重複が無いこと(全オブジェクト) ---
  const counts = {
    lead: (await one(`SELECT Id FROM Lead WHERE DentShift_Clinic_Id__c = '${clinic.id}'`)).length,
    account: (await one(`SELECT Id FROM Account WHERE DentShift_Clinic_Id__c = '${clinic.id}'`)).length,
    contact: (await one(`SELECT Id FROM Contact WHERE DentShift_User_Id__c = '${contact.id}'`)).length,
    opportunity: (await one(`SELECT Id FROM Opportunity WHERE DentShift_Subscription_Id__c != null AND Account.DentShift_Clinic_Id__c = '${clinic.id}'`)).length,
    diagnosis: (await one(`SELECT Id FROM DentShift_Diagnosis__c WHERE DentShift_Clinic_Id__c = '${clinic.id}'`)).length,
    consultation: (await one(`SELECT Id FROM DentShift_Consultation__c WHERE DentShift_Clinic_Id__c = '${clinic.id}'`)).length,
  };
  check(
    "重複なし(リード1・取引先1・責任者1・商談1・診断1・相談2)",
    JSON.stringify(counts) === JSON.stringify({ lead: 1, account: 1, contact: 1, opportunity: 1, diagnosis: 1, consultation: 2 }),
    JSON.stringify(counts)
  );
  const leftover = await prisma.integrationEvent.count({ where: { status: { not: "synced" } } });
  check("未送信イベントが残っていない", leftover === 0, `${leftover}件`);

  // --- 9. リード変換時の電話禁止保持(2026-10-02発見の欠落ケース) ---
  // 修正前は「Lead=true(禁止)、既存Contact=false(通話可)」のまま変換すると、Salesforce標準の
  // リード項目対応付けが既存Contactの値を上書きしないため、Leadの禁止情報が失われていた
  // (変換直後からContactはfalseのまま=架電可能に見えてしまう隙間が生じていた)。
  // Flow「DentShift_Preserve_Do_Not_Call_On_Convert」(After Save、変換と同一トランザクション)
  // で、変換直後にContactへtrueを補正する。これを恒久的な回帰テストとして記録する。
  if (process.env.SALESFORCE_ADMIN_CLIENT_ID && process.env.SALESFORCE_ADMIN_CLIENT_SECRET) {
    const adminSf = await salesforceSession(process.env.SALESFORCE_ADMIN_CLIENT_ID, process.env.SALESFORCE_ADMIN_CLIENT_SECRET);
    const convAccount = await adminSf.call(`/sobjects/Account`, {
      method: "POST",
      body: JSON.stringify({ Name: `【検証】既存取引先-conv-${runId}` }),
    }) as { id: string };
    const convContact = await adminSf.call(`/sobjects/Contact`, {
      method: "POST",
      body: JSON.stringify({
        LastName: `【検証】既存責任者-conv-${runId}`,
        AccountId: convAccount.id,
        DentShift_Do_Not_Call__c: false,
        DentShift_Do_Not_Call_Reason__c: "【検証】E2E: 事前に同意済み(通話可)として作成",
      }),
    }) as { id: string };
    const convLead = await adminSf.call(`/sobjects/Lead`, {
      method: "POST",
      body: JSON.stringify({ LastName: `【検証】変換太郎-conv-${runId}`, Company: `【検証】変換医院-conv-${runId}`, Status: "Open - Not Contacted" }),
    }) as { id: string };
    await adminSf.executeAnonymous(
      `Database.LeadConvert lc = new Database.LeadConvert();lc.setLeadId('${convLead.id}');lc.setContactId('${convContact.id}');lc.setAccountId('${convAccount.id}');lc.convertedStatus='Qualified';lc.setDoNotCreateOpportunity(true);Database.LeadConvertResult r = Database.convertLead(lc);if(!r.isSuccess()){throw new System.StringException(String.join(r.getErrors(),','));}`
    );
    const convContactAfter = await adminSf.call(`/sobjects/Contact/${convContact.id}`) as { DentShift_Do_Not_Call__c: boolean };
    check(
      "変換: Lead=禁止・既存Contact=通話可のマージで、禁止情報が失われず変換直後にContactへ反映される",
      convContactAfter.DentShift_Do_Not_Call__c === true,
      `既存Contact変換前=false → 変換直後=${convContactAfter.DentShift_Do_Not_Call__c}(trueが期待値)`
    );
    await adminSf.call(`/sobjects/Contact/${convContact.id}`, { method: "DELETE" });
    await adminSf.call(`/sobjects/Account/${convAccount.id}`, { method: "DELETE" });
  } else {
    check(
      "変換: Lead=禁止・既存Contact=通話可のマージで、禁止情報が失われず変換直後にContactへ反映される",
      false,
      "未検証: SALESFORCE_ADMIN_CLIENT_ID/SECRET が未設定(Database.convertLeadの実行には管理者用認証が必要)"
    );
  }

  const report = {
    runId,
    clinicId: clinic.id,
    records: { leadId: leads[0]?.Id, accountId: accounts[0]?.Id, instanceUrl: sf.instanceUrl },
    passed: checks.filter((c) => c.ok).length,
    failed: checks.filter((c) => !c.ok).length,
    checks,
  };
  mkdirSync(path.join(process.cwd(), "salesforce", "e2e-reports"), { recursive: true });
  const out = path.join(process.cwd(), "salesforce", "e2e-reports", `${runId}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed / ${report.failed} failed`);
  console.log(`画面確認: ${sf.instanceUrl}/lightning/r/Account/${accounts[0]?.Id}/view (リード: /lightning/r/Lead/${leads[0]?.Id}/view)`);
  console.log(`report: ${path.relative(process.cwd(), out)}`);
  await prisma.$disconnect();
  if (report.failed > 0) process.exitCode = 1;
}

async function cleanup(sf: Awaited<ReturnType<typeof salesforceSession>>, id: string) {
  // 検証レポートに記録した医院IDの検証データだけを削除する(Sandboxのみ。main()で確認済み)。
  const report = JSON.parse(readFileSync(path.join(process.cwd(), "salesforce", "e2e-reports", `${id}.json`), "utf8")) as { clinicId: string };
  const clinicId = report.clinicId.replace(/[^A-Za-z0-9_-]/g, "");
  const del = async (sobject: string, where: string) => {
    const rows = await sf.soql<{ Id: string }>(`SELECT Id FROM ${sobject} WHERE ${where}`);
    for (const row of rows) await sf.call(`/sobjects/${sobject}/${row.Id}`, { method: "DELETE" });
    console.log(`deleted ${sobject}: ${rows.length}`);
  };
  await del("DentShift_Consultation__c", `DentShift_Clinic_Id__c = '${clinicId}'`);
  await del("DentShift_Diagnosis__c", `DentShift_Clinic_Id__c = '${clinicId}'`);
  await del("Opportunity", `Account.DentShift_Clinic_Id__c = '${clinicId}'`);
  await del("Contact", `Account.DentShift_Clinic_Id__c = '${clinicId}'`);
  await del("Account", `DentShift_Clinic_Id__c = '${clinicId}'`);
  await del("Lead", `DentShift_Clinic_Id__c = '${clinicId}'`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
