import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

/**
 * 2026-09-29追加(PO指摘、匿名ユーザーの識別強化P0)。
 *
 * 背景: 診断API(/api/diagnosis)の冪等性principalKeyは、未ログイン利用者を
 * IPハッシュだけで識別していた。同じ院内共有回線(同じIP)を使う複数の別々の
 * 利用者が、意図せず同じ主体として扱われてしまう(本人識別の代わりにはできない)。
 *
 * 対応: session.ts(ログイン済みContact用)と同じ「不透明なopaqueトークンを
 * httpOnly cookieに保存する」パターンを、未ログイン利用者専用に導入する。
 * ログインとは異なりDBには一切紐づけない(サーバー側は値の存在を検証しない、
 * ブラウザだけが保持する使い捨ての識別子)。同一ブラウザからの再送・タイムアウト後の
 * 再送では同じcookie値が送られるため、同じ主体として扱い続けられる一方、
 * 同じIPの別ブラウザ・別利用者は別のcookie値を持つため別主体として扱われる。
 *
 * 診断結果自体へのアクセス制御(getDiagnosisById、diagnosisIdを知っていれば
 * 閲覧できる設計)には触れない。このcookieは冪等性キー(clientRequestId)の
 * principalKeyとしてのみ使う。
 */
export const ANONYMOUS_DIAGNOSIS_SESSION_COOKIE = "ds_anon_diag";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24; // 24時間(診断1回分のセッションとして十分な長さ)

export async function getOrCreateAnonymousDiagnosisSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(ANONYMOUS_DIAGNOSIS_SESSION_COOKIE)?.value;
  if (existing) return existing;

  const value = randomUUID();
  store.set(ANONYMOUS_DIAGNOSIS_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return value;
}
