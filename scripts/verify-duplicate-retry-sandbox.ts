// 2026-10-03追加(PO承認: Sandbox限定の再現検証)。
// 本人実行専用スクリプト。Claude(AI)はこのスクリプトを実行しません。
//
// 目的: `upsertContactAllowingOwnLeadDuplicate`(src/server/services/salesforceSync.ts)が
// 実際のSalesforce Sandbox(dsverify)に対して、
//   (A) 検出された重複候補が「この医院自身の未コンバートLead」だけの場合に限定再送で成功する
//   (B) 候補に無関係なLeadが1件でも混ざっていれば保存を拒否する
// という分岐を、クライアント関数を再実装せず「本物の関数を通して」確認する。
//
// 安全対策・制約:
//   - 書き込み先はSandbox(dsverify)のみ。本番Salesforceには一切接続しない
//     (実行前にdsverify接続・組織ID一致を必ず確認してから進める)。
//   - test.dentshift.jpへのデプロイは不要。このスクリプトはローカル端末で
//     直接Salesforce Sandboxへ接続する(dent-shift-testのDB/IntegrationEventキューには
//     一切触れない)。
//   - ログに出すのは「検証用相関ID・候補数・判定結果(true/false)・再送結果」のみ。
//     メールアドレス・Salesforceレコードの実IDはコンソールへ出力しない
//     (作成したレコードの一覧は、コンソールではなくローカルの出力ファイルにのみ記録する)。
//   - 作成したレコード(Lead/Account/Contact)は削除しない(今回承認された範囲外)。
//     一覧は `scripts/output/sandbox-duplicate-repro-<相関ID>.json` に保存する。
//
// 事前準備(実行前に手動で行う):
//   環境変数 SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET / SALESFORCE_LOGIN_URL /
//   SALESFORCE_EXPECTED_ORG_ID を、dsverify用の値でシェルにexportしておく
//   (このファイルには値を書き込まない。貼り付け・表示もしない)。
//
// 使い方:
//   cd /Users/masatokimura/Documents/dent-shift
//   SALESFORCE_CLIENT_ID=... SALESFORCE_CLIENT_SECRET=... SALESFORCE_LOGIN_URL=... \
//   SALESFORCE_EXPECTED_ORG_ID=... npx tsx scripts/verify-duplicate-retry-sandbox.ts

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  parseSalesforceCredentialsForDiagnosticsOnly,
  SalesforceConfigError,
} from "../src/server/config/salesforceConfig";
import {
  getSalesforceRecordByExternalId,
  upsertSalesforceRecordByExternalId,
  clearSalesforceTokenCacheForTests,
  SalesforceDeliveryError,
  ORG_MISMATCH_ERROR_CODE,
  OAUTH_ERROR_CODE,
} from "../src/server/providers/salesforce/salesforceClient";
import {
  SF_FIELDS,
  buildContactFields,
  type ClinicSnapshot,
  type ContactSnapshot,
} from "../src/domain/integration/salesforceCrmMapping";
import { upsertContactAllowingOwnLeadDuplicate } from "../src/server/services/salesforceSync";

const correlationId = randomUUID();

function log(event: string, data: Record<string, unknown> = {}) {
  // メールアドレス・Salesforceレコードの実IDはここに含めない。
  console.log(JSON.stringify({ correlationId, event, ...data }));
}

function emptyClinicSnapshot(id: string, name: string): ClinicSnapshot {
  return {
    id,
    name,
    directorName: null,
    url: "https://example-dentshift-repro.invalid/",
    contactEmail: null,
    contactPhone: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    diagnosisCount: 0,
    latestDiagnosis: null,
    firstContactCreatedAt: null,
  };
}

function contactSnapshot(id: string, email: string): ContactSnapshot {
  return {
    id,
    email,
    phoneNumber: null,
    role: "owner",
    registrationStep: "completed",
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    consentAcceptedAt: null,
  };
}

async function ensureConnected(config: Awaited<ReturnType<typeof parseSalesforceCredentialsForDiagnosticsOnly>>) {
  const loginUrlIsSandboxHost = /--[^.]+\.sandbox\./.test(new URL(config.loginUrl).host);
  log("sandbox_host_check", { loginUrlIsSandboxHost });
  if (!loginUrlIsSandboxHost) {
    throw new Error(
      "SALESFORCE_LOGIN_URLがSandboxホスト名の規則(--xxx.sandbox.)に一致しません。本番への誤接続を避けるため中断します。"
    );
  }
  clearSalesforceTokenCacheForTests();
  try {
    await getSalesforceRecordByExternalId({
      config,
      sobject: "Lead",
      externalIdField: "DentShift_Clinic_Id__c",
      externalId: "__dentshift_connection_check__",
      fields: [],
    });
    log("connection_check", { connected: true, orgIdMatches: true });
  } catch (error) {
    if (error instanceof SalesforceDeliveryError) {
      if (error.errorCode === ORG_MISMATCH_ERROR_CODE || error.errorCode === OAUTH_ERROR_CODE) {
        log("connection_check", { connected: false, orgIdMatches: false, errorCode: error.errorCode });
        throw new Error("dsverify接続または組織ID一致の確認に失敗しました。中断します。");
      }
      // 読み取りクエリ自体のエラー(項目不足等)は接続自体は成功しているとみなす。
      log("connection_check", { connected: true, orgIdMatches: true });
      return;
    }
    throw error;
  }
}

async function createLead(config: Awaited<ReturnType<typeof parseSalesforceCredentialsForDiagnosticsOnly>>, clinicId: string, email: string, companyName: string) {
  const result = await upsertSalesforceRecordByExternalId({
    config,
    sobject: "Lead",
    externalIdField: SF_FIELDS.lead.externalId,
    externalId: clinicId,
    fields: { Company: companyName, LastName: companyName, Email: email },
  });
  return result;
}

async function createAccount(config: Awaited<ReturnType<typeof parseSalesforceCredentialsForDiagnosticsOnly>>, clinicId: string, name: string) {
  return upsertSalesforceRecordByExternalId({
    config,
    sobject: "Account",
    externalIdField: SF_FIELDS.account.externalId,
    externalId: clinicId,
    fields: { Name: name },
  });
}

async function main() {
  let config;
  try {
    config = parseSalesforceCredentialsForDiagnosticsOnly({ env: process.env });
  } catch (error) {
    const message = error instanceof SalesforceConfigError ? error.message : "unknown config error";
    log("config_error", { message });
    process.exit(1);
  }

  await ensureConnected(config);

  const createdRecords: { sobjectType: string; externalId: string; email?: string }[] = [];

  // --- シナリオA: 自医院の未コンバートLeadのみ → 限定再送で成功するはず ---
  const clinicAId = `repro-${correlationId}-own`;
  const emailA = `repro+${correlationId}-own@dentshift-repro.invalid`;
  await createLead(config, clinicAId, emailA, `Repro Clinic A ${correlationId}`);
  createdRecords.push({ sobjectType: "Lead", externalId: clinicAId, email: emailA });
  await createAccount(config, clinicAId, `Repro Clinic A ${correlationId}`);
  createdRecords.push({ sobjectType: "Account", externalId: clinicAId });

  const clinicA = emptyClinicSnapshot(clinicAId, `Repro Clinic A ${correlationId}`);
  const contactA = contactSnapshot(`repro-contact-${correlationId}-own`, emailA);
  let scenarioAResult: "retried_and_succeeded" | "rejected" | "unexpected_error" = "unexpected_error";
  try {
    await upsertContactAllowingOwnLeadDuplicate({
      config,
      clinic: clinicA,
      contact: contactA,
      fields: buildContactFields({ clinic: clinicA, contact: contactA }),
      beforeWrite: async () => {},
    });
    scenarioAResult = "retried_and_succeeded";
    createdRecords.push({ sobjectType: "Contact", externalId: contactA.id, email: emailA });
  } catch (error) {
    scenarioAResult = "rejected";
    if (!(error instanceof SalesforceDeliveryError)) throw error;
  }
  log("scenario_a_own_lead_only", {
    result: scenarioAResult,
    expected: "retried_and_succeeded",
    matchesExpectation: scenarioAResult === "retried_and_succeeded",
  });

  // --- シナリオB: 候補に無関係なLeadが混ざる → 保存拒否されるはず ---
  const clinicBId = `repro-${correlationId}-target`;
  const clinicUnrelatedId = `repro-${correlationId}-unrelated`;
  const emailB = `repro+${correlationId}-shared@dentshift-repro.invalid`;
  await createLead(config, clinicBId, emailB, `Repro Clinic B ${correlationId}`);
  createdRecords.push({ sobjectType: "Lead", externalId: clinicBId, email: emailB });
  await createAccount(config, clinicBId, `Repro Clinic B ${correlationId}`);
  createdRecords.push({ sobjectType: "Account", externalId: clinicBId });
  // 無関係な医院の、同じメールアドレスを持つLead(標準重複ルールのEmail一致で
  // シナリオBのContact作成時に「無関係な候補」として一緒に検出されることを狙う)。
  await createLead(config, clinicUnrelatedId, emailB, `Repro Clinic Unrelated ${correlationId}`);
  createdRecords.push({ sobjectType: "Lead", externalId: clinicUnrelatedId, email: emailB });

  const clinicB = emptyClinicSnapshot(clinicBId, `Repro Clinic B ${correlationId}`);
  const contactB = contactSnapshot(`repro-contact-${correlationId}-target`, emailB);
  let scenarioBResult: "retried_and_succeeded" | "rejected" | "unexpected_error" = "unexpected_error";
  try {
    await upsertContactAllowingOwnLeadDuplicate({
      config,
      clinic: clinicB,
      contact: contactB,
      fields: buildContactFields({ clinic: clinicB, contact: contactB }),
      beforeWrite: async () => {},
    });
    scenarioBResult = "retried_and_succeeded";
    createdRecords.push({ sobjectType: "Contact", externalId: contactB.id, email: emailB });
  } catch (error) {
    scenarioBResult = "rejected";
    if (!(error instanceof SalesforceDeliveryError)) throw error;
  }
  log("scenario_b_unrelated_candidate_mixed_in", {
    result: scenarioBResult,
    expected: "rejected",
    matchesExpectation: scenarioBResult === "rejected",
  });

  // 保存拒否されたはずのシナリオBで、本当にContactが作成されていないことを確認する。
  const contactBAfter = await getSalesforceRecordByExternalId({
    config,
    sobject: "Contact",
    externalIdField: SF_FIELDS.contact.externalId,
    externalId: contactB.id,
    fields: ["Id"],
  });
  log("scenario_b_contact_not_created_check", { contactExists: contactBAfter !== null });

  mkdirSync("scripts/output", { recursive: true });
  const outputPath = `scripts/output/sandbox-duplicate-repro-${correlationId}.json`;
  writeFileSync(outputPath, JSON.stringify({ correlationId, createdRecords }, null, 2));
  log("done", { outputPath });
}

main().catch((error) => {
  log("fatal_error", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
