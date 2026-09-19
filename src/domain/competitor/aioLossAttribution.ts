import type {
  AioLossConfidence,
  AioLossRootCauseKey,
  AioLossRootCauseSummary,
  PatientQuestionResult,
} from "./types";

/**
 * 「なぜ負けている?」root cause判定ロジックのバージョン(2026-09-06のユーザー指示)。
 * 後からロジックが変更されても、過去診断がどのロジックで判定されたかを
 * questionResultsJson内のanalysisVersionから再現できるようにするためのタグ。
 * attributeQuestionLoss/aggregateAioLossRootCausesの判定基準を変更する場合は
 * 必ずこの値を更新すること(過去診断の値は変更しない=後方互換のための追跡)。
 *
 * v2: 2026-09-06のユーザー追加指示により判定ロジックを修正したため改版。
 * (1) competitorMentionsの有無だけからAIO:citation_acquisitionを生成しないように変更
 * (競合の「言及」と競合の「citation/link獲得」は別signalであり、後者を確認できる
 * 構造化フィールドが現在のAiObservationResultに存在しないため)。
 * (2) mock由来のevidenceが実測(non-mock)evidenceのconfidenceを汚染しない/底上げしない
 * ように、non-mock evidenceが1件でもあればmockを判定から完全に除外する方式へ変更。
 *
 * v3(2026-09-08): 2026-09-08のユーザー指示により、rootCauseKeyの判定式自体
 * (mentioned/competitorMentionsベースのai_search_presence判定)は変更していないが、
 * attributionの実行契約・provenance semanticsが変わったため改版する。
 * (1) canonical measured観測(measurementStatus==="measured")を正式なroot cause
 * evidenceとして使用できるようになった(mapCanonicalMeasuredForLossAttribution経由)。
 * (2) legacy語彙"live"を退役し、`sourceType: "mock"|"canonical_measurement"`へ
 * 正式移行(旧`dataSource: "mock"|"live"`は廃止)。
 * (3) canonical measured由来のsourceTypeは"canonical_measurement"を出力し、
 * provisionalは常にfalseになる。
 * (4) win/close/lose判定に実際に使用したcanonical evidence集合(measuredCanonicalObservations)
 * を、root cause判定でもそのまま共有する契約になった(root cause側でprovider間の
 * win/loseを再決定しない)。
 * analysisVersionは判定式だけでなく、診断結果がどの実行契約・provenance semanticsの
 * もとで生成されたかを後から再現・説明できることを優先し、判定式が同一でもこの改版を行う。
 */
export const AIO_LOSS_ATTRIBUTION_LOGIC_VERSION = "aio-loss-attribution@2026-09-08.1";

/**
 * attributeQuestionLossが必要とする観測の最小shape。
 * domain層はserver層(server/providers/ai/types.ts の AiObservationResult)にも
 * ai-measurementドメイン(AiMeasurementObservation)にも依存しない、判定に必要な
 * 最小限のフィールドだけを持つ中立の形状として定義する。
 *
 * 2026-09-08のユーザー指示(canonical measured loseのroot cause本接続ラウンド)により、
 * 従来の`dataSource: "mock" | "live"`(AiObservationResultと同名同語彙)を退役し、
 * `sourceType: "mock" | "canonical_measurement"`へ正式移行した。理由:
 * - 今後canonical経路ではlegacy語彙の"live"を使用しない方針が確定したため
 *   ("canonical → legacy live"という縮退adapterを作らない)。
 * - "live"はlegacy実providerが実装されたことがなく実DBにも1件も存在しない死んだ
 *   リテラルであるため、退役してもデータ移行は不要(実装時に確認済み)。
 *
 * このinterfaceはAiObservationResultにもAiMeasurementObservationにも構造的に一致しない
 * (どちらも`dataSource`/`sourceType`の語彙・型が異なる)ため、呼び出し側
 * (runFreeDiagnosis.ts)は必ず専用のmapper関数(mapLegacyForLossAttribution /
 * mapCanonicalMeasuredForLossAttribution)を介して変換すること。
 */
export interface LossAttributionObservationInput {
  mentioned: boolean;
  competitorMentions: string[];
  sourceType: "mock" | "canonical_measurement";
}

const ROOT_CAUSE_LABELS: Record<AioLossRootCauseKey, string> = {
  "AIO:ai_search_presence":
    "AIの回答に自院が表示されていない(AI検索での露出不足。競合も表示されていないケースを含む)",
  "AIO:citation_acquisition":
    "AIの回答で競合は引用・言及されているが、自院は引用・言及されていない(引用獲得の差)",
  "AIO:recommendation_rank": "AIの回答で自院は表示されているが、競合より推薦順位が低い",
  "AIO:information_accuracy": "AIの回答に自院に関する明確な情報不一致・誤認がある",
  "AIO:question_domain_coverage": "特定の質問領域で自院に関する情報が不足している",
  "aio-loss:unattributed": "質問単位の根拠が不足しており、原因を特定できない",
};

export type LossAttributionFields = Pick<
  PatientQuestionResult,
  | "competitorDifference"
  | "rootCauseKey"
  | "rootCauseLabel"
  | "confidence"
  | "sourceType"
  | "provisional"
  | "attributionStatus"
  | "analysisVersion"
>;

/** status !== "lose" の質問に使う既定値(判定対象外であることを明示する)。 */
export const NOT_APPLICABLE_LOSS_ATTRIBUTION: LossAttributionFields = {
  competitorDifference: [],
  rootCauseKey: null,
  rootCauseLabel: null,
  confidence: null,
  sourceType: null,
  provisional: false,
  attributionStatus: "not_applicable",
  analysisVersion: null,
};

function confidenceRank(confidence: AioLossConfidence): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default: {
      const exhaustive: never = confidence;
      return exhaustive;
    }
  }
}

/**
 * status === "lose" の患者質問1件について、その質問自身のAiObservationResultのみを
 * 根拠にroot causeを判定する(2026-09-06のユーザー指示: 質問単位のevidence-first
 * attribution。AIO domain scoreの弱さを主判定に使わない。あくまで将来の補助情報)。
 *
 * [judging evidence と traceability用evidenceの分離(2026-09-06の追加ユーザー指示(2))]
 * mockはad-complianceで確定した「mockは実測を汚染しない」原則と同様に扱う:
 * - non-mock(実測。legacy live/canonical measuredのいずれか)のobservationsが1件でも
 *   存在する場合、判定(judging)はそれだけを対象にし、mock observationsは原因判定・
 *   confidence計算から完全に除外する(mockが実測のconfidenceを下げることも、
 *   上げることも無い)。
 * - non-mockが1件も無い場合のみ、mockをjudging evidenceとして使い、provisional=trueにする。
 * - competitorDifference(表示・traceability用)は、mock/non-mockを問わず全observationsから
 *   機械的に集計する(root cause判定そのものには使わない。将来UIの参考情報用)。
 *
 * [citation_acquisitionの生成条件(2026-09-06の追加ユーザー指示(1))]
 * 「競合が言及されている」ことと「競合がcitation/linkを獲得している」ことは別のsignalであり、
 * AIO:citation_acquisitionへattributionしてよいのは、質問単位のevidence上で
 * 「競合にcitation/linkがある」かつ「自院にはcitation/linkが無い」ことを構造化データから
 * 直接確認できる場合だけである。現在のAiObservationResult(LossAttributionObservationInput)
 * には競合側のcitation/link有無を示すフィールドが存在しないため、P0では
 * competitorMentionsの有無だけからAIO:citation_acquisitionを生成することはしない
 * (「競合が出ているからcitation不足だろう」という推測は禁止)。
 *
 * P0でjudging evidenceから機械的に判定可能なのは以下の1パターンのみ:
 * - judging evidence上で自院が直接確認できる形で言及されていない → AIO:ai_search_presence
 * それ以外(AIO:citation_acquisition / recommendation_rank / information_accuracy /
 * question_domain_coverage)は、対応する構造化signalが存在しないため生成しない(捏造しない)。
 * judging evidence上で自院の非言及を直接確認できない場合はinsufficient_evidenceを返す。
 */
export function attributeQuestionLoss(
  observations: LossAttributionObservationInput[]
): LossAttributionFields {
  if (observations.length === 0) {
    return {
      ...NOT_APPLICABLE_LOSS_ATTRIBUTION,
      attributionStatus: "insufficient_evidence",
      analysisVersion: AIO_LOSS_ATTRIBUTION_LOGIC_VERSION,
    };
  }

  // 表示・traceability用: root cause判定には使わない、参考情報としての競合言及一覧
  const competitorDifference = Array.from(
    new Set(observations.flatMap((obs) => obs.competitorMentions))
  );

  // judging evidenceの選定: non-mock(実測)が1件でもあればそれだけで判定し、mockは
  // 完全に除外する(mockによる汚染防止・底上げ防止の両方)。non-mockが無ければmockで判定し、
  // provisional=trueにする。
  const nonMockObservations = observations.filter((obs) => obs.sourceType !== "mock");
  const judgingObservations = nonMockObservations.length > 0 ? nonMockObservations : observations;
  const provisional = nonMockObservations.length === 0;
  const sourceType: "mock" | "canonical_measurement" = provisional ? "mock" : "canonical_measurement";

  // judging evidence全体で自院が直接「言及されていない」ことを確認できる場合のみ
  // AIO:ai_search_presenceを割り当てる。judging evidence内でmentionedの値が揺れている
  // (自院が言及されている観測が混ざっている)場合は、原因を捏造せずinsufficient_evidenceにする。
  const allNotMentioned = judgingObservations.every((obs) => !obs.mentioned);
  if (!allNotMentioned) {
    return {
      competitorDifference,
      rootCauseKey: null,
      rootCauseLabel: null,
      confidence: null,
      sourceType: null,
      provisional: false,
      attributionStatus: "insufficient_evidence",
      analysisVersion: AIO_LOSS_ATTRIBUTION_LOGIC_VERSION,
    };
  }

  const rootCauseKey: AioLossRootCauseKey = "AIO:ai_search_presence";
  // 現時点でjudging evidenceから機械的に到達可能なrootCauseKeyはai_search_presenceのみで
  // あり、そのbase confidenceは常にmedium(mock/non-mockいずれで判定してもhighへは上げない)。
  const confidence: AioLossConfidence = "medium";

  return {
    competitorDifference,
    rootCauseKey,
    rootCauseLabel: ROOT_CAUSE_LABELS[rootCauseKey],
    confidence,
    sourceType,
    provisional,
    attributionStatus: "attributed",
    analysisVersion: AIO_LOSS_ATTRIBUTION_LOGIC_VERSION,
  };
}

interface RootCauseGroup {
  rootCauseKey: AioLossRootCauseKey;
  rootCauseLabel: string;
  linkedQuestions: string[];
  confidences: AioLossConfidence[];
  competitorNames: Set<string>;
  provisionalFlags: boolean[];
  analysisVersion: string;
}

/**
 * 永続化済みのquestionResults(質問単位のattribution)から、全体で重要なroot cause TOP3を
 * 集約する(2026-09-06のユーザー指示: on-demand集約。この集約結果自体は永続化しない。
 * questionResultsさえ保存されていれば、後からロジックを変更しても再集約できる)。
 *
 * attributionStatus === "attributed" の質問のみを対象にする
 * (insufficient_evidence/not_applicableは集約・ランキング対象に含めない=原因を捏造しない)。
 * 同一rootCauseKeyの質問は1件に統合し(重複表示しない)、どの質問から導かれたかは
 * linkedQuestions で追跡可能にする(将来UIで'詳細展開用)。
 */
export function aggregateAioLossRootCauses(
  questionResults: PatientQuestionResult[]
): AioLossRootCauseSummary[] {
  const groups = new Map<AioLossRootCauseKey, RootCauseGroup>();

  for (const result of questionResults) {
    if (result.attributionStatus !== "attributed" || result.rootCauseKey === null) {
      continue;
    }
    const key = result.rootCauseKey;
    const existing = groups.get(key);
    if (existing) {
      existing.linkedQuestions.push(result.question);
      existing.confidences.push(result.confidence ?? "low");
      existing.provisionalFlags.push(result.provisional);
      for (const name of result.competitorDifference) existing.competitorNames.add(name);
    } else {
      groups.set(key, {
        rootCauseKey: key,
        rootCauseLabel: result.rootCauseLabel ?? ROOT_CAUSE_LABELS[key],
        linkedQuestions: [result.question],
        confidences: [result.confidence ?? "low"],
        competitorNames: new Set(result.competitorDifference),
        provisionalFlags: [result.provisional],
        analysisVersion: result.analysisVersion ?? AIO_LOSS_ATTRIBUTION_LOGIC_VERSION,
      });
    }
  }

  const summaries: AioLossRootCauseSummary[] = Array.from(groups.values()).map((group) => {
    // 複数質問が同一原因に紐づく場合、最も弱い(=最小)confidenceに合わせる
    // (一部の強いevidenceだけで全体を過大主張しない。2026-09-06のユーザー指示)。
    const weakestConfidence = group.confidences.reduce((weakest, current) =>
      confidenceRank(current) < confidenceRank(weakest) ? current : weakest
    );
    return {
      rootCauseKey: group.rootCauseKey,
      rootCauseLabel: group.rootCauseLabel,
      linkedQuestions: group.linkedQuestions,
      affectedQuestionCount: group.linkedQuestions.length,
      confidence: weakestConfidence,
      competitorGapStrength: group.competitorNames.size,
      isProvisional: group.provisionalFlags.some(Boolean),
      analysisVersion: group.analysisVersion,
    };
  });

  // 決定論的ランキング(恣意的な重み付けを避け、優先順位付きタプル比較にする。
  // 2026-09-06のユーザー指示: 1.confidence 2.影響したlose質問数 3.competitor gapの強さ
  // 4.provisional/estimated penalty を考慮した上で、最後にrootCauseKeyの文字列比較で
  // 決定論的にtie-breakする)。
  summaries.sort((a, b) => {
    if (confidenceRank(b.confidence) !== confidenceRank(a.confidence)) {
      return confidenceRank(b.confidence) - confidenceRank(a.confidence);
    }
    if (b.affectedQuestionCount !== a.affectedQuestionCount) {
      return b.affectedQuestionCount - a.affectedQuestionCount;
    }
    if (b.competitorGapStrength !== a.competitorGapStrength) {
      return b.competitorGapStrength - a.competitorGapStrength;
    }
    if (a.isProvisional !== b.isProvisional) {
      return a.isProvisional ? 1 : -1;
    }
    return a.rootCauseKey.localeCompare(b.rootCauseKey);
  });

  // 件数を無理に3件へ埋めない(十分な根拠が無いのに水増ししない。2026-09-06のユーザー指示)。
  return summaries.slice(0, 3);
}
