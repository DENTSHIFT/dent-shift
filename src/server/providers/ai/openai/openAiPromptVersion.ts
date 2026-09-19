/**
 * OpenAI patient question prompt templateのversion tagの唯一のsource of truth
 * (2026-09-08のユーザー指示: OPENAI_PROMPT_VERSION一元化ラウンド)。
 *
 * 以下の両方が必ずこのモジュールからimportする(どちらも独自の定数を持たない):
 * - ./openAiAdapter.ts(measurementMeta.promptVersionを生成する側)
 * - @/server/providers/ai-measurement/openai/openAiPromptBuilder.ts
 *   (実際にrequest descriptor.promptVersionを構築する側)
 *
 * 【一元化した理由】Phase 1では上記2箇所がそれぞれ独立した定数
 * ("openai_patient_question_prompt_v1"と"...v2")を持っており、実通信接続後に
 * 「実際にはv2のprompt templateでrequestを構築したのに、保存される
 * measurementMeta.promptVersionはadapter側の古い値のまま」という測定再現性の
 * 破綻リスクがあった。単一定数化することで、request構築側とmetadata生成側が
 * 構造的に常に同じ値を返すことを保証する(過剰設計を避け、単一定数の共有だけで
 * 一致を保証する。OpenAiFetchOutcome/adapter inputへ実際に使用したpromptVersionを
 * 明示的に運ぶ案は、単一source of truthで完全に一致を保証できるためP0では採用しない)。
 *
 * 実prompt templateを初めて定義した2026-09-08時点の値("...v1"は旧fixture検証専用の
 * placeholderであり、現行versionとしては使わない)。
 */
export const OPENAI_PROMPT_VERSION = "openai_patient_question_prompt_v2";
