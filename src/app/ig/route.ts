import { NextResponse } from "next/server";
import { IG_REDIRECT_TARGET } from "./igRedirectTarget";

// 2026-09-24: Instagramプロフィール欄に載せる短縮URL。管理・共有のしやすさのため
// dentshift.jp/ig という短い経路を用意し、実際の遷移先(UTM付き/visual)へ307で
// リダイレクトする。恒久リダイレクト(308/permanent)にしないのは、将来キャンペーンの
// 遷移先やUTM値を変更する可能性があるため(ブラウザ・検索エンジンにキャッシュさせない)。
// /ig自体にはコンテンツを持たせない(常にこのリダイレクトのみ)。
export function GET(request: Request) {
  return NextResponse.redirect(new URL(IG_REDIRECT_TARGET, request.url), 307);
}
