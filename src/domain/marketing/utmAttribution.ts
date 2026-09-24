// 2026-09-24: Instagram等の流入チャネル別に診断「開始」と「完了」を比較するための
// UTM値の取り扱いを一箇所に集約する(diagnosis-started API・diagnosis API・
// /visualのCTAリンク生成の3箇所で同じルールを使う)。

export const UTM_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type UtmParamKey = (typeof UTM_PARAM_KEYS)[number];

export type UtmAttribution = Record<UtmParamKey, string | null>;

const MAX_UTM_LENGTH = 100;
// URLパラメータとして一般的に安全な文字種のみ許可する(英数字・._~%+-)。
// スペースや絵文字、HTMLメタ文字等が混入した値は個人情報混入や表示崩れのリスクが
// あるため、部分的に切り詰めるのではなく丸ごとnull(不採用)として扱う。
const ALLOWED_UTM_VALUE = /^[A-Za-z0-9._~%+-]{1,100}$/;

/**
 * 公開エンドポイント(認証不要)が受け取る生のUTM値を検証する。
 * 長さ超過・許可外文字種のいずれかに該当する値はnullにする(部分採用しない)。
 */
export function sanitizeUtmValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_UTM_LENGTH) return null;
  return ALLOWED_UTM_VALUE.test(trimmed) ? trimmed : null;
}

/**
 * 任意の入力オブジェクト(リクエストボディ等)から、UTM5項目だけを検証済みの形で
 * 取り出す。存在しない・不正な項目はnullになる(部分的に諦めるのではなく、
 * 5項目とも同じ形状のオブジェクトを常に返す)。
 */
export function sanitizeUtmAttribution(input: Record<string, unknown>): UtmAttribution {
  return {
    utm_source: sanitizeUtmValue(input.utmSource ?? input.utm_source),
    utm_medium: sanitizeUtmValue(input.utmMedium ?? input.utm_medium),
    utm_campaign: sanitizeUtmValue(input.utmCampaign ?? input.utm_campaign),
    utm_content: sanitizeUtmValue(input.utmContent ?? input.utm_content),
    utm_term: sanitizeUtmValue(input.utmTerm ?? input.utm_term),
  };
}

/**
 * URLSearchParams(ブラウザ側でのクエリ読み取り)からUTM5項目を検証済みの形で取り出す。
 */
export function sanitizeUtmAttributionFromSearchParams(params: URLSearchParams): UtmAttribution {
  return {
    utm_source: sanitizeUtmValue(params.get("utm_source")),
    utm_medium: sanitizeUtmValue(params.get("utm_medium")),
    utm_campaign: sanitizeUtmValue(params.get("utm_campaign")),
    utm_content: sanitizeUtmValue(params.get("utm_content")),
    utm_term: sanitizeUtmValue(params.get("utm_term")),
  };
}
