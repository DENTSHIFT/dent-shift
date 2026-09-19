import { describe, expect, it } from "vitest";
import { buildDiagnosisResultEmail } from "@/domain/email/diagnosisResultEmail";

describe("diagnosisResultEmail", () => {
  it("診断URL・総合結果・改善TOP3・サンプル表示を本文へ含める", () => {
    const message = buildDiagnosisResultEmail({
      clinicName: "テスト歯科",
      resultUrl: "https://dent-shift.example.com/diagnosis/result/diagnosis-1",
      totalPoints: 72,
      totalStatus: "partial",
      maxPoints: 100,
      isSample: true,
      improvements: [
        { title: "改善1", recommendedAction: "対応1" },
        { title: "改善2", recommendedAction: "対応2" },
        { title: "改善3", recommendedAction: "対応3" },
        { title: "改善4", recommendedAction: "対応4" },
      ],
    });

    expect(message.subject).toContain("テスト歯科");
    expect(message.text).toContain("72/100点");
    expect(message.text).toContain("一部未測定を含む暫定結果");
    expect(message.text).toContain("参考データ");
    expect(message.text).toContain("/diagnosis/result/diagnosis-1");
    expect(message.text).toContain("改善3");
    expect(message.text).not.toContain("改善4");
  });

  it("利用者入力をHTMLへ未加工で差し込まない", () => {
    const message = buildDiagnosisResultEmail({
      clinicName: '<script>alert("x")</script>',
      resultUrl: "https://dent-shift.example.com/result?id=1&from=mail",
      totalPoints: 0,
      totalStatus: "unavailable",
      maxPoints: 100,
      isSample: false,
      improvements: [
        { title: "<b>項目</b>", recommendedAction: '属性"を確認' },
      ],
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain("<b>項目</b>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("&lt;b&gt;項目&lt;/b&gt;");
    expect(message.html).toContain("&amp;from=mail");
    expect(message.text).toContain("総合スコアは、現在のデータでは算出できませんでした。");
  });

  it("医院名の改行を件名へ持ち込まない", () => {
    const message = buildDiagnosisResultEmail({
      clinicName: "テスト歯科\r\nBcc: attacker@example.com",
      resultUrl: "https://dent-shift.example.com/diagnosis/result/1",
      totalPoints: 80,
      totalStatus: "measured",
      maxPoints: 100,
      isSample: false,
      improvements: [],
    });

    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.subject).toContain("テスト歯科 Bcc: attacker@example.com");
  });
});
