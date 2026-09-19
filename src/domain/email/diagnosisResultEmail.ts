import type { OverallScoreStatus } from "@/domain/diagnosis/types";

export interface DiagnosisResultEmailImprovement {
  title: string;
  recommendedAction: string;
}

export interface BuildDiagnosisResultEmailInput {
  clinicName: string;
  resultUrl: string;
  totalPoints: number;
  totalStatus: OverallScoreStatus;
  maxPoints: number;
  isSample: boolean;
  improvements: DiagnosisResultEmailImprovement[];
}

export interface DiagnosisResultEmailMessage {
  subject: string;
  text: string;
  html: string;
}

const STATUS_LABEL: Record<OverallScoreStatus, string> = {
  measured: "実測結果",
  estimated: "一部推定値を含む結果",
  partial: "一部未測定を含む暫定結果",
  unavailable: "総合スコア未算出",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeEmailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function scoreText(input: BuildDiagnosisResultEmailInput): string {
  if (input.totalStatus === "unavailable") {
    return "総合スコアは、現在のデータでは算出できませんでした。";
  }
  return `総合スコア: ${input.totalPoints}/${input.maxPoints}点（${STATUS_LABEL[input.totalStatus]}）`;
}

/**
 * 診断結果メールの表示内容を組み立てる純粋関数。
 * HTMLへ利用者入力を差し込む前に必ずescapeし、サンプル結果はメール内でも明示する。
 */
export function buildDiagnosisResultEmail(
  input: BuildDiagnosisResultEmailInput
): DiagnosisResultEmailMessage {
  const improvements = input.improvements.slice(0, 3);
  const score = scoreText(input);
  const sampleNotice = input.isSample
    ? "この診断には参考データ（サンプル・推定値）が含まれ、実際の医院データとは異なる場合があります。"
    : null;

  const textImprovements = improvements.length
    ? improvements
        .map(
          (improvement, index) =>
            `${index + 1}. ${improvement.title}\n   ${improvement.recommendedAction}`
        )
        .join("\n")
    : "診断結果ページで詳細をご確認ください。";

  const text = [
    `${input.clinicName} ご担当者様`,
    "",
    "DENT SHIFTのAI集患診断をご利用いただき、ありがとうございます。",
    score,
    sampleNotice,
    "",
    "改善項目",
    textImprovements,
    "",
    "診断結果を見る",
    input.resultUrl,
    "",
    "このメールは診断時に入力された医院の代表メールアドレス宛に送信しています。",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const escapedClinicName = escapeHtml(input.clinicName);
  const escapedResultUrl = escapeHtml(input.resultUrl);
  const htmlImprovements = improvements.length
    ? `<ol>${improvements
        .map(
          (improvement) =>
            `<li style="margin-bottom:12px"><strong>${escapeHtml(improvement.title)}</strong><br>${escapeHtml(improvement.recommendedAction)}</li>`
        )
        .join("")}</ol>`
    : "<p>診断結果ページで詳細をご確認ください。</p>";

  const html = `<!doctype html>
<html lang="ja">
  <body style="margin:0;background:#f5f7fa;color:#0f1b2d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #e5e9f0;border-radius:16px;padding:28px">
        <p>${escapedClinicName} ご担当者様</p>
        <h1 style="font-size:22px;margin:20px 0 12px">AI集患診断の結果ができました</h1>
        <p>DENT SHIFTのAI集患診断をご利用いただき、ありがとうございます。</p>
        <p style="font-weight:700">${escapeHtml(score)}</p>
        ${sampleNotice ? `<p style="padding:12px;background:#fff8e6;border-radius:8px">${escapeHtml(sampleNotice)}</p>` : ""}
        <h2 style="font-size:18px;margin-top:28px">改善項目</h2>
        ${htmlImprovements}
        <p style="margin:28px 0">
          <a href="${escapedResultUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">診断結果を見る</a>
        </p>
        <p style="font-size:12px;color:#6b7280">このメールは診断時に入力された医院の代表メールアドレス宛に送信しています。</p>
      </div>
    </div>
  </body>
</html>`;

  return {
    // 件名へ改行を持ち込ませず、メールヘッダーとして安全な1行にする。
    subject: `【DENT SHIFT】${sanitizeEmailHeader(input.clinicName)}様のAI集患診断結果`,
    text,
    html,
  };
}
