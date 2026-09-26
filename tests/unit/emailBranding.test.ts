import { describe, expect, it } from "vitest";
import {
  getEmailLogoUrl,
  buildEmailLogoHeaderHtml,
  wrapEmailBodyHtml,
} from "@/domain/email/emailBranding";
import { buildDiagnosisResultEmail } from "@/domain/email/diagnosisResultEmail";
import { buildEmailVerificationMessage } from "@/domain/email/emailVerification";

/**
 * 2026-09-24: アプリメール(診断結果・メール確認・課金通知・管理者パスワード再設定)の
 * ヘッダーロゴ統一。LPヘッダー(MarketingHeader.tsx)と同じ正式ロゴファイルを、
 * 絶対HTTPS URL・alt="DENT SHIFT"付きで使うことを確認する。
 * TimeRexの予約通知メールはこのモジュールの対象外(TimeRex管理画面側の設定)。
 */
describe("emailBranding", () => {
  it("ロゴURLは絶対HTTPS URLで、既定は本番オリジンの白背景の正式ロゴ", () => {
    expect(getEmailLogoUrl({})).toBe("https://dentshift.jp/brand/logo/DENT_SHIFT_email_official.png");
    expect(getEmailLogoUrl({ APP_BASE_URL: "https://test.dentshift.jp" })).toBe(
      "https://test.dentshift.jp/brand/logo/DENT_SHIFT_email_official.png"
    );
    expect(getEmailLogoUrl({ APP_BASE_URL: "http://insecure.example" })).toMatch(/^https:\/\/dentshift\.jp\//);
    expect(getEmailLogoUrl({ APP_BASE_URL: "not a url" })).toMatch(/^https:\/\/dentshift\.jp\//);
  });

  it("buildEmailLogoHeaderHtmlはalt=\"DENT SHIFT\"と適切な表示サイズを持つimgタグを返す", () => {
    const html = buildEmailLogoHeaderHtml();
    expect(html).toContain(`src="${getEmailLogoUrl()}"`);
    expect(html).toContain('alt="DENT SHIFT"');
    expect(html).toContain('background:#ffffff');
    expect(html).toContain('width="160"');
    expect(html).toContain('height="50"');
  });

  it("wrapEmailBodyHtmlは本文を変更せず、ロゴヘッダーとシェルだけを追加する", () => {
    const body = "<p>本文テスト</p>";
    const wrapped = wrapEmailBodyHtml(body);
    expect(wrapped).toContain(body);
    expect(wrapped).toContain(getEmailLogoUrl());
    expect(wrapped).toContain("<!doctype html>");
  });
});

describe("各メールテンプレートにロゴヘッダーが含まれる", () => {
  it("診断結果メール", () => {
    const message = buildDiagnosisResultEmail({
      clinicName: "テスト歯科",
      resultUrl: "https://dentshift.jp/diagnosis/result/1",
      totalPoints: 50,
      totalStatus: "partial",
      maxPoints: 100,
      isSample: false,
      improvements: [],
    });
    expect(message.html).toContain(getEmailLogoUrl());
    expect(message.html).toContain('alt="DENT SHIFT"');
  });

  it("メールアドレス確認メール", () => {
    const message = buildEmailVerificationMessage({
      clinicName: "テスト歯科",
      verifyUrl: "https://dentshift.jp/verify-email?token=abc",
    });
    expect(message.html).toContain(getEmailLogoUrl());
    expect(message.html).toContain('alt="DENT SHIFT"');
  });
});
