import { describe, expect, it } from "vitest";
import { wrapEmailBodyHtml } from "@/domain/email/emailBranding";
import { buildDiagnosisResultEmail } from "@/domain/email/diagnosisResultEmail";
import { buildEmailVerificationMessage } from "@/domain/email/emailVerification";

// 2026-09-27: ダークモードでの見え方の問題から、アプリメールにはロゴ画像を入れない。
describe("emailBranding", () => {
  it("wrapEmailBodyHtmlは本文を変更せずシェルだけを追加し、画像を含めない", () => {
    const body = "<p>本文テスト</p>";
    const wrapped = wrapEmailBodyHtml(body);
    expect(wrapped).toContain(body);
    expect(wrapped).toContain("<!doctype html>");
    expect(wrapped).not.toContain("<img");
  });

  it("診断結果メールにロゴ画像を含めない", () => {
    const message = buildDiagnosisResultEmail({
      clinicName: "テスト歯科",
      resultUrl: "https://dentshift.jp/diagnosis/result/1",
      totalPoints: 50,
      totalStatus: "partial",
      maxPoints: 100,
      isSample: false,
      improvements: [],
    });
    expect(message.html).not.toContain("<img");
  });

  it("メールアドレス確認メールにロゴ画像を含めない", () => {
    const message = buildEmailVerificationMessage({
      clinicName: "テスト歯科",
      verifyUrl: "https://dentshift.jp/verify-email?token=abc",
    });
    expect(message.html).not.toContain("<img");
  });
});
