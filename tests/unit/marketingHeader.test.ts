import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

/**
 * 2026-09-29追加(PO指示): トップページにログイン導線が無く、既存会員が
 * ダッシュボードへ迷わずたどり着けない問題の回帰テスト。
 * MarketingHeaderは`getCurrentContact`(既存のセッションCookie検証、
 * /api/auth/me等と同一のもの)をそのまま利用するサーバーコンポーネントの
 * ため、ここではその関数だけをモックし、実際のCookie/DBには触れない。
 */
vi.mock("@/server/auth/session", () => ({
  getCurrentContact: vi.fn(),
}));

import { getCurrentContact } from "@/server/auth/session";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";

const mockedGetCurrentContact = vi.mocked(getCurrentContact);

async function renderHeader(): Promise<string> {
  const element = await MarketingHeader();
  return renderToStaticMarkup(createElement(element.type, element.props));
}

describe("MarketingHeader(トップページのログイン導線)", () => {
  beforeEach(() => {
    mockedGetCurrentContact.mockReset();
  });

  it("未ログイン時は「料金」「ログイン」「無料診断」を表示し、ログインは/loginへ遷移する", async () => {
    mockedGetCurrentContact.mockResolvedValue(null);
    const html = await renderHeader();

    expect(html).toContain(">料金<");
    expect(html).toContain(">ログイン<");
    expect(html).toContain(">無料診断<");
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/diagnosis"');
    // 未ログイン時は「ダッシュボード」を出さない
    expect(html).not.toContain("ダッシュボード");
  });

  it("ログイン済み時は「ログイン」「無料診断」の代わりに「ダッシュボード」を表示する", async () => {
    mockedGetCurrentContact.mockResolvedValue({
      id: "contact_1",
      email: "clinic@example.com",
      clinic: { name: "テスト歯科", directorName: "テスト院長", url: "https://example.jp" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const html = await renderHeader();

    expect(html).toContain(">料金<");
    expect(html).toContain(">ダッシュボード<");
    expect(html).toContain('href="/dashboard"');
    // ログイン済み時は「ログイン」「無料診断」への導線を出さない
    expect(html).not.toContain(">ログイン<");
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain(">無料診断<");
  });

  it("モバイル向けログインバー(未ログイン時のみ表示)にも/loginへのリンクを含む", async () => {
    mockedGetCurrentContact.mockResolvedValue(null);
    const html = await renderHeader();

    expect(html).toContain("ds-marketing-mobile-login-bar");
    const mobileBarMatch = html.match(
      /<div class="ds-marketing-mobile-login-bar"[\s\S]*?<\/div>/
    );
    expect(mobileBarMatch).not.toBeNull();
    expect(mobileBarMatch![0]).toContain('href="/login"');
  });

  it("フォーカス表示用のCSS(:focus-visible)をログイン・無料診断・ダッシュボードリンクに適用する", async () => {
    mockedGetCurrentContact.mockResolvedValue(null);
    const html = await renderHeader();

    expect(html).toContain("focus-visible");
    expect(html).toContain("ds-marketing-login-link:focus-visible");
    expect(html).toContain("ds-marketing-diagnosis-link:focus-visible");
  });
});
