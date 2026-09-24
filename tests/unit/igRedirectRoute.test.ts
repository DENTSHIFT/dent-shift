import { describe, expect, it } from "vitest";
import { GET } from "@/app/ig/route";
import { IG_REDIRECT_TARGET } from "@/app/ig/igRedirectTarget";

/**
 * 2026-09-24: Instagramプロフィール用の短縮URL(/ig)。
 * /visual?utm_source=instagram&utm_medium=profile&utm_campaign=launch への
 * 一時リダイレクト(307)であることを確認する。恒久リダイレクト(308)にしないのは、
 * 将来キャンペーンの遷移先を変更できるようにするため。
 */
describe("GET /ig", () => {
  it("307(一時リダイレクト)で/visualへUTM付きでリダイレクトする", async () => {
    const request = new Request("https://dentshift.jp/ig");
    const response = GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://dentshift.jp/visual?utm_source=instagram&utm_medium=profile&utm_campaign=launch"
    );
  });

  it("308(恒久リダイレクト)ではない", async () => {
    const request = new Request("https://dentshift.jp/ig");
    const response = GET(request);
    expect(response.status).not.toBe(308);
  });

  it("リダイレクト先の定数はutm_source/medium/campaignの3項目を含む", () => {
    expect(IG_REDIRECT_TARGET).toBe(
      "/visual?utm_source=instagram&utm_medium=profile&utm_campaign=launch"
    );
  });

  it("クエリ等が付与された/igへのアクセスでも、リダイレクト先は固定される(便乗パラメータを混入させない)", () => {
    const request = new Request("https://dentshift.jp/ig?utm_source=other&foo=bar");
    const response = GET(request);
    expect(response.headers.get("location")).toBe(
      "https://dentshift.jp/visual?utm_source=instagram&utm_medium=profile&utm_campaign=launch"
    );
  });
});
