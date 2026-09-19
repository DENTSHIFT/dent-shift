/**
 * OpenAI Responses API + Web Search 手動smoke test script(Phase 4、2026-09-08の
 * ユーザー指示)。
 *
 * 【これは何か】
 * production無料診断route(src/app/api/diagnosis/route.ts)とは完全に独立した、
 * 人間が明示的にterminalから実行する専用scriptである。npm run dev/build/start/test
 * のいずれからも自動実行されない(package.jsonのどのscriptからも呼び出されていない
 * ことを確認すること)。
 *
 * 【何をするか】
 * MEASUREMENT_PLAN(src/domain/ai-measurement/measurementPlan.ts)からtargetProviders
 * に"openai"を含む最初の質問を1問だけ取得し、Phase 3で組み上げたcomposition経路
 * (OpenAiSdkTransport → OpenAiResponsesClient → OpenAiMeasurementProvider)を直接
 * 構築して、その1問についてちょうど1回だけ実際のOpenAI Responses APIを呼び出す。
 *
 * 【呼ばないもの】
 * - 既存無料診断route全体(runFreeDiagnosis / score / root cause / overallScore)
 * - diagnosisRepository(DB書き込みは一切行わない)
 * - legacy mock provider
 *
 * 【env設計(2026-09-08のユーザー指示: 比較検討の結果)】
 * このscriptは`AI_MEASUREMENT_PROVIDER`を一切読まない。理由: production composition
 * root(route.ts)は"mock"/"openai"を実行時に切り替える必要があるためこのflagが必須だが、
 * このscriptはOpenAI経路1本しか存在せず、flagを読んでも分岐先が無い。あえて読む場合、
 * 「smoke scriptを動かすためだけにAI_MEASUREMENT_PROVIDER=openaiを設定する」という、
 * 本番provider切替と紛らわしい手順が増えるだけであり、安全側に倒してこのscript専用の
 * 直接的なOpenAiMeasurementConfig解決(createAiMeasurementProviderFromConfigへ明示的に
 * {provider:"openai",...}を渡す)を採用する。OPENAI_API_KEY/OPENAI_AI_MEASUREMENT_MODEL
 * 自体は既存Phase 3のenv名をそのまま流用する(この2つはprovider実装そのものに必要な
 * 資格情報であり、production envと衝突する概念ではないため)。
 *
 * clinic情報(SMOKE_CLINIC_NAME/SMOKE_CLINIC_URL)は既存production envと意図的に
 * 別名にしている(実在医院情報を人間が明示入力する運用を強制するため)。
 *
 * 【server-only境界に関する実行時の注意(2026-09-08のユーザー指示のPhase 3.2
 * ラウンドで見つかった問題と同種)】
 * このscriptがimportするaiMeasurementConfig.ts/openAiSdkTransport.ts/
 * aiMeasurementProviderFactory.tsはいずれも先頭で`import "server-only";`を
 * 宣言している。実際の"server-only" packageはpackage.jsonのexports条件分岐で
 * "react-server"条件時はempty.js(no-op)、それ以外はindex.js(無条件throw)へ
 * 解決される。Next.js本体はServer Componentのbundle時にこの"react-server"条件を
 * 自動的に付与するが、tsxで直接この.tsファイルを実行する場合はNode本来の
 * conditional exports解決に委ねられるため、Node公式の`--conditions`(`-C`)flag
 * (Node v22.9.0/v20.18.0でstable化、experimentalではない)を使って明示的に
 * "react-server"条件を指定する必要がある。tsxはNode CLI flagをそのまま
 * 下位のnodeプロセスへ渡すため、package.jsonのscript定義側で
 * `tsx --conditions=react-server scripts/openai-measurement-smoke.ts`という
 * 形にしている(このscriptファイル自体には手を加えていない。vitest.config.tsの
 * aliasとは別の、Node標準機構によるもの)。
 */

import {
  MEASUREMENT_PLAN,
} from "@/domain/ai-measurement/measurementPlan";
import type { CompetitorClinic } from "@/domain/competitor/types";
import {
  DEFAULT_OPENAI_MAX_ATTEMPTS,
  DEFAULT_OPENAI_TIMEOUT_MS,
  type OpenAiMeasurementConfig,
} from "@/server/config/aiMeasurementConfig";
import { createAiMeasurementProviderFromConfig } from "@/server/composition/aiMeasurementProviderFactory";
import { validateAiMeasurementObservation } from "@/domain/ai-measurement/invariants";
import { OPENAI_PROMPT_VERSION } from "@/server/providers/ai/openai/openAiAdapter";
import type { AiMeasurementObservation } from "@/domain/ai-measurement/types";

/**
 * env値をAPI key等の値そのものを一切表示せずに検証するためのヘルパー。
 * 必須envが欠落している場合、変数名だけを列挙した明示errorをthrowする
 * (値は絶対にmessageへ含めない)。
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new SmokeConfigError(`必須環境変数 '${name}' が未設定です(値は表示しません)。`);
  }
  return value;
}

class SmokeConfigError extends Error {}

/**
 * console出力からAPI keyの値そのものが漏れることを防ぐ、防御的な追加対策。
 * (aiMeasurementConfig.ts / OpenAI公式SDKのエラーメッセージ自体はkey文字列を
 * 含まない設計/実装だが、想定外の経路での混入に備えた最終防御ラインとして
 * 二重に用意する)。
 */
function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      result = result.split(secret).join("***REDACTED***");
    }
  }
  return result;
}

interface SmokeSuccessCheck {
  label: string;
  passed: boolean | null; // null = このケース区分では判定対象外(reference/unavailable等)
}

async function main(): Promise<void> {
  console.log("=== OpenAI Responses API + Web Search 手動smoke test ===");
  console.log("(1 patient question = 1 Responses API call。DB保存・score接続なし)");
  console.log("");

  // --- 1. env検証(ネットワーク呼び出しより前に、全て明示的に検証する) ---
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = requireEnv("OPENAI_AI_MEASUREMENT_MODEL");
  const clinicName = requireEnv("SMOKE_CLINIC_NAME");
  const clinicUrl = requireEnv("SMOKE_CLINIC_URL");
  const secrets = [apiKey];

  // --- 2. MEASUREMENT_PLANからtargetProviders.includes("openai")の最初の質問を取得 ---
  // 文字列をこのscript内に重複hardcodeしない(2026-09-08のユーザー指示)。
  const targetEntry = MEASUREMENT_PLAN.questions.find((q) =>
    q.targetProviders.includes("openai")
  );
  if (!targetEntry) {
    throw new SmokeConfigError(
      `MEASUREMENT_PLAN(planVersion='${MEASUREMENT_PLAN.planVersion}')に` +
        `targetProviders.includes("openai")の質問が1件も存在しません。`
    );
  }
  const question = targetEntry.question;

  console.log(`[question]        ${question}`);
  console.log(`[planVersion]     ${MEASUREMENT_PLAN.planVersion}`);
  console.log(`[requestedModel]  ${model}`);
  console.log(`[clinicName]      ${clinicName}`);
  console.log("");
  console.log(">>> OpenAI Responses APIへ実際にリクエストを送信します(課金対象)。");
  console.log("");

  // --- 3. AI_MEASUREMENT_PROVIDERを読まず、OpenAI configを直接構築する ---
  const config: OpenAiMeasurementConfig = {
    provider: "openai",
    apiKey,
    model,
    timeoutMs: DEFAULT_OPENAI_TIMEOUT_MS,
    maxAttempts: DEFAULT_OPENAI_MAX_ATTEMPTS,
  };

  // overridesを渡さない = 実際のOpenAiSdkTransport(実SDK・実ネットワーク)を構築する。
  const provider = createAiMeasurementProviderFromConfig(config);
  if (!provider) {
    // config.provider==="openai"のときundefinedは返らない実装契約だが、
    // 型上undefinedを許容するため防御的にthrowする。
    throw new SmokeConfigError(
      "createAiMeasurementProviderFromConfig(openai)がundefinedを返しました(想定外)。"
    );
  }

  const competitors: CompetitorClinic[] = [];

  // --- 4. ちょうど1回だけobserve()を呼ぶ(loopなし、batchなし) ---
  const startedAt = Date.now();
  const observations = await provider.observe({
    clinicName,
    clinicUrl,
    patientQuestions: [question],
    competitors,
  });
  const elapsedMs = Date.now() - startedAt;

  if (observations.length !== 1) {
    throw new SmokeConfigError(
      `observe()が${observations.length}件のobservationを返しました(1件を期待)。`
    );
  }
  const observation = observations[0]!;

  // --- 5. canonical invariant(このscriptでも改めて明示的に検証する) ---
  let invariantPassed = false;
  let invariantError: string | null = null;
  try {
    validateAiMeasurementObservation(observation);
    invariantPassed = true;
  } catch (err) {
    invariantError = err instanceof Error ? err.message : String(err);
  }

  printSafeObservation(observation, { requestedModel: model, elapsedMs });
  printSuccessChecklist(observation, invariantPassed);

  if (invariantError) {
    console.log("");
    console.log(`[canonical invariant] FAIL: ${redactSecrets(invariantError, secrets)}`);
    process.exitCode = 1;
  }
}

/**
 * terminalへ表示してよい安全な項目だけを出力する(2026-09-08のユーザー指示)。
 * raw responseやprompt全文は一切参照・表示しない(このscriptはそもそもraw
 * response自体を保持していない。convertOpenAiResponseToObservation内部でのみ
 * raw fixtureを扱い、このscriptに戻ってくるのはcanonical observationのみ)。
 */
function printSafeObservation(
  observation: AiMeasurementObservation,
  extra: { requestedModel: string; elapsedMs: number }
): void {
  const meta = observation.measurementMeta;
  const safeView = {
    question: observation.question,
    providerId: observation.providerId,
    requestedModel: extra.requestedModel,
    providerReportedModelId: meta?.providerReportedModelId ?? null,
    sourceType: observation.sourceType,
    measurementStatus: observation.measurementStatus,
    searchExecuted: meta?.searchExecuted ?? null,
    searchQueries: meta?.searchQueries ?? null,
    mentioned: observation.mentioned,
    recommendationRank: observation.recommendationRank,
    citationsCount: observation.citations?.length ?? null,
    citations: observation.citations,
    competitorMentions: observation.competitorMentions,
    providerResponseId: meta?.providerResponseId ?? null,
    usage: meta?.usage ?? null,
    promptVersion: meta?.promptVersion ?? null,
    unavailableReason: observation.unavailableReason,
    provisional: observation.provisional,
    elapsedMs: extra.elapsedMs,
  };
  console.log("--- safe observation projection(raw responseは含まない) ---");
  console.log(JSON.stringify(safeView, null, 2));
}

function printSuccessChecklist(
  observation: AiMeasurementObservation,
  invariantPassed: boolean
): void {
  const meta = observation.measurementMeta;

  console.log("");
  if (observation.measurementStatus === "measured") {
    console.log("=== smoke結果分類: SUCCESS(measured: 検索実行あり) ===");
  } else if (observation.measurementStatus === "reference") {
    console.log(
      "=== smoke結果分類: REFERENCE(API疎通成功・Web Search未実行。失敗ではない) ==="
    );
  } else {
    console.log(
      `=== smoke結果分類: UNAVAILABLE(unavailableReason='${observation.unavailableReason}') ===`
    );
  }

  const checks: SmokeSuccessCheck[] = [
    { label: "1. request成功(unavailableReason===null)", passed: observation.unavailableReason === null },
    { label: "2. web_search_call存在(searchExecuted===true)", passed: meta?.searchExecuted ?? null },
    { label: '3. measurementStatus==="measured"', passed: observation.measurementStatus === "measured" },
    { label: '4. providerId==="openai"', passed: observation.providerId === "openai" },
    { label: '5. sourceType==="ai_provider"', passed: observation.sourceType === "ai_provider" },
    { label: "6. providerResponseIdあり", passed: meta ? meta.providerResponseId !== null : null },
    { label: "7. providerReportedModelIdあり", passed: meta ? meta.providerReportedModelId !== null : null },
    { label: "8. usageあり", passed: meta ? meta.usage !== null : null },
    {
      label: `9. measurementMeta.promptVersion===現行v2('${OPENAI_PROMPT_VERSION}')`,
      passed: meta ? meta.promptVersion === OPENAI_PROMPT_VERSION : null,
    },
    { label: "10. canonical invariant PASS", passed: invariantPassed },
    { label: "11. raw response保存なし(structural: このscriptはraw responseを保持しない)", passed: true },
    { label: "12. DB writeなし(structural: diagnosisRepositoryを一切importしていない)", passed: true },
  ];

  console.log("");
  console.log("--- smoke success条件チェックリスト ---");
  for (const check of checks) {
    const mark = check.passed === null ? "N/A" : check.passed ? "PASS" : "FAIL";
    console.log(`[${mark}] ${check.label}`);
  }
}

main().catch((err) => {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const message = err instanceof Error ? err.message : String(err);
  console.error("");
  console.error("=== smoke test failed ===");
  console.error(redactSecrets(`${err instanceof Error ? err.constructor.name : "Error"}: ${message}`, [apiKey]));
  process.exitCode = 1;
});
