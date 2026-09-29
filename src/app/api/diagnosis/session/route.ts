import { NextResponse } from "next/server";
import { getOrCreateAnonymousDiagnosisSessionId } from "@/server/auth/anonymousDiagnosisSession";

/**
 * 2026-09-29追加(PO指摘、匿名Cookie初回リクエスト対策P0)。
 *
 * 背景: 匿名利用者の冪等性principalKeyに使うセッションcookie
 * (ds_anon_diag、anonymousDiagnosisSession.ts)を、これまでPOST /api/diagnosisの
 * レスポンスで初めて発行していた。通信切断でこのレスポンス自体がブラウザへ
 * 届かなかった場合、cookieも保存されない。その状態で同じclientRequestIdを使って
 * 再送すると、毎回新しい匿名セッション(=新しいprincipalKey)が発行され続け、
 * 既存ロックとprincipal_mismatchになり、いつまでも成功しない。
 *
 * 対応: 診断フォームのページ表示時点で、このGETを1回呼びcookieを先に確立させる
 * (診断結果を含まない軽量なGETのため、POST自体よりレスポンスが届きやすい)。
 * POST /api/diagnosisからも同じgetOrCreateAnonymousDiagnosisSessionId()を呼ぶため、
 * 既にcookieがあればそれをそのまま使う(この事前呼び出しは「確立を早める」ための
 * ものであり、POST側の呼び出しを置き換えるものではない)。
 */
export async function GET() {
  await getOrCreateAnonymousDiagnosisSessionId();
  return NextResponse.json({ ok: true });
}
