import type {
  AiMeasurementObservation,
  AiObservationFieldProvenance,
  FieldProvenance,
} from "./types";
import { resolveObservationProvisional } from "./observationProvisional";

/**
 * AiMeasurementObservationのdomain invariant違反を表すエラー。
 * 2026-09-07のユーザー指示: 純粋validation関数として実装し、violationがあれば
 * このエラーをthrowする(値を黙って補正・握りつぶさない)。
 */
export class AiMeasurementInvariantViolationError extends Error {}

const FIELD_PROVENANCE_KEYS: Array<keyof AiObservationFieldProvenance> = [
  "mentioned",
  "recommendationRank",
  "citations",
  "competitorMentions",
];

/**
 * AiMeasurementObservation 1件のdomain invariantを検証する純粋関数。
 * 違反があれば AiMeasurementInvariantViolationError をthrowする(戻り値はvoid)。
 * DB/ネットワーク等の副作用は一切持たない。
 *
 * 検証するinvariant(2026-09-07のユーザー指示、最低限のものそのまま):
 * 1. measurementStatus === "unavailable"
 *    → unavailableReason必須(非null)
 *    → mentioned/recommendationRank/citations/competitorMentions は全てnull
 * 2. measurementStatus !== "unavailable"
 *    → unavailableReason は必ずnull
 * 3. fieldProvenanceの各フィールド:
 *    - measurementStatus === "unavailable" → derivation は null
 *    - measurementStatus !== "unavailable" → derivation は "direct"|"derived"|"estimated"
 *      のいずれか(非null)
 * 4. sourceType === "ai_provider" → measurementMeta必須(非null)
 * 5. observation単位のprovisionalは、resolveObservationProvisional(sourceType,
 *    measurementStatus)の戻り値と一致しなければならない(2026-09-07のユーザー指示:
 *    「APIなしのcanonical persistence bridge」。repositoryがprovisionalを独自に
 *    再計算する場合でも、providerが設定したprovisionalがルールと矛盾していないことを
 *    ここで保証する。矛盾を黙って上書きせず、明示的にエラーにする)。
 *
 * mock/reference観測(sourceType==="mock")はmeasurementMeta=nullのままで良く、
 * このバリデーションはそれを拒否しない(=既存mock診断との後方互換を壊さない)。
 */
export function validateAiMeasurementObservation(obs: AiMeasurementObservation): void {
  if (obs.measurementStatus === "unavailable") {
    if (obs.unavailableReason === null) {
      throw new AiMeasurementInvariantViolationError(
        "measurementStatus='unavailable' requires a non-null unavailableReason"
      );
    }
    if (obs.mentioned !== null) {
      throw new AiMeasurementInvariantViolationError(
        "measurementStatus='unavailable' requires mentioned=null"
      );
    }
    if (obs.recommendationRank !== null) {
      throw new AiMeasurementInvariantViolationError(
        "measurementStatus='unavailable' requires recommendationRank=null"
      );
    }
    if (obs.citations !== null) {
      throw new AiMeasurementInvariantViolationError(
        "measurementStatus='unavailable' requires citations=null"
      );
    }
    if (obs.competitorMentions !== null) {
      throw new AiMeasurementInvariantViolationError(
        "measurementStatus='unavailable' requires competitorMentions=null"
      );
    }
  } else if (obs.unavailableReason !== null) {
    throw new AiMeasurementInvariantViolationError(
      `measurementStatus='${obs.measurementStatus}' requires unavailableReason=null`
    );
  }

  if (obs.sourceType === "ai_provider" && obs.measurementMeta === null) {
    throw new AiMeasurementInvariantViolationError(
      "sourceType='ai_provider' requires a non-null measurementMeta"
    );
  }

  const expectedProvisional = resolveObservationProvisional(
    obs.sourceType,
    obs.measurementStatus
  );
  if (obs.provisional !== expectedProvisional) {
    throw new AiMeasurementInvariantViolationError(
      `provisional=${obs.provisional} does not match resolveObservationProvisional(sourceType='${obs.sourceType}', measurementStatus='${obs.measurementStatus}')=${expectedProvisional}`
    );
  }

  if (obs.measurementMeta !== null) {
    for (const key of FIELD_PROVENANCE_KEYS) {
      validateFieldProvenance(key, obs.measurementMeta.fieldProvenance[key]);
    }
  }
}

function validateFieldProvenance(
  fieldName: keyof AiObservationFieldProvenance,
  provenance: FieldProvenance
): void {
  if (provenance.measurementStatus === "unavailable") {
    if (provenance.derivation !== null) {
      throw new AiMeasurementInvariantViolationError(
        `field '${fieldName}': measurementStatus='unavailable' requires derivation=null`
      );
    }
  } else if (provenance.derivation === null) {
    throw new AiMeasurementInvariantViolationError(
      `field '${fieldName}': measurementStatus='${provenance.measurementStatus}' requires a non-null derivation ("direct" | "derived" | "estimated")`
    );
  }
}
