import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  verifyEmailToken: vi.fn(),
  findActiveUnusedPilotInviteByEmail: vi.fn(),
  getCurrentContact: vi.fn(),
}));

vi.mock("@/server/services/verifyEmailToken", () => ({
  verifyEmailToken: mocks.verifyEmailToken,
}));
vi.mock("@/server/db/inviteRepository", () => ({
  findActiveUnusedPilotInviteByEmail: mocks.findActiveUnusedPilotInviteByEmail,
}));
vi.mock("@/server/auth/session", () => ({
  getCurrentContact: mocks.getCurrentContact,
}));

import VerifyEmailPage from "@/app/verify-email/page";

/**
 * 2026-10-03(PO指摘): /verify-emailで"already_verified_via_session"の表示が、
 * 「このリンク自体が成功した」ように誤読されないことの回帰テスト。
 * ロジック(verifyEmailToken)自体はモックで固定し、ここではページの表示文言のみを検証する。
 */
describe("/verify-email ページ表示", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findActiveUnusedPilotInviteByEmail.mockResolvedValue(null);
    mocks.getCurrentContact.mockResolvedValue({ id: "contact-1" });
  });

  it("already_verified_via_session: 『リンクは無効』と『ログイン中アカウントは確認済み』の両方を明示し、『確認が完了しました』という(リンク自体が成功したと読める)文言は出さない", async () => {
    mocks.verifyEmailToken.mockResolvedValue({
      status: "already_verified_via_session",
      contactId: "contact-1",
      email: "owner@example.com",
    });

    const tree = await VerifyEmailPage({ searchParams: Promise.resolve({ token: "used-token" }) });
    const html = renderToStaticMarkup(tree);

    // リンク自体が無効/使用済みであることが明示されている
    expect(html).toContain("このリンクは無効ですが");
    expect(html).toContain("すでに使用されているか無効です");
    // ログイン中アカウントが確認済みであることも明示されている
    expect(html).toContain("ログイン中のアカウント");
    expect(html).toContain("owner@example.com");
    expect(html).toContain("確認が完了しています");
    // 「このリンク自体が成功した」と読める見出し文言(通常の成功時の文言)は出ない
    expect(html).not.toContain("メールアドレスの確認が完了しました");
  });

  it("通常のalready_verified(トークン自身の持ち主が既に確認済み)は従来通り『確認が完了しました』系の文言のまま", async () => {
    mocks.verifyEmailToken.mockResolvedValue({
      status: "already_verified",
      contactId: "contact-1",
      email: "owner@example.com",
    });

    const tree = await VerifyEmailPage({ searchParams: Promise.resolve({ token: "already-used-by-owner" }) });
    const html = renderToStaticMarkup(tree);

    expect(html).toContain("メールアドレスの確認が完了しました");
    expect(html).toContain("このメールアドレスは既に確認済みです");
  });

  it("verified: 通常の成功文言のまま変化しない", async () => {
    mocks.verifyEmailToken.mockResolvedValue({
      status: "verified",
      contactId: "contact-1",
      email: "owner@example.com",
    });

    const tree = await VerifyEmailPage({ searchParams: Promise.resolve({ token: "fresh-token" }) });
    const html = renderToStaticMarkup(tree);

    expect(html).toContain("メールアドレスの確認が完了しました");
    expect(html).toContain("ご登録のメールアドレスが確認できました。");
  });

  it("ページの表示処理自体はverifyEmailTokenの結果をそのまま表示するだけで、DBへの書き込み関数を一切呼ばない(表示専用であることの確認)", async () => {
    mocks.verifyEmailToken.mockResolvedValue({
      status: "already_verified_via_session",
      contactId: "contact-1",
      email: "owner@example.com",
    });

    await VerifyEmailPage({ searchParams: Promise.resolve({ token: "used-token" }) });

    // ページ側はverifyEmailToken/findActiveUnusedPilotInviteByEmail/getCurrentContact以外の
    // 書き込み系APIを呼び出す手段を持たない(importしていない)ため、
    // ここではverifyEmailTokenが読み取り目的の呼び出し(引数)で1回だけ呼ばれたことを確認する。
    expect(mocks.verifyEmailToken).toHaveBeenCalledTimes(1);
    expect(mocks.verifyEmailToken).toHaveBeenCalledWith("used-token", { sessionContactId: "contact-1" });
  });
});
