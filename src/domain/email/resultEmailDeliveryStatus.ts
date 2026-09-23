export const RESULT_EMAIL_DELIVERY_STATUSES = [
  "pending",
  "sent",
  "failed",
  "disabled",
] as const;

export type ResultEmailDeliveryStatus = (typeof RESULT_EMAIL_DELIVERY_STATUSES)[number];

export function normalizeResultEmailDeliveryStatus(
  value: string
): ResultEmailDeliveryStatus {
  return RESULT_EMAIL_DELIVERY_STATUSES.includes(value as ResultEmailDeliveryStatus)
    ? (value as ResultEmailDeliveryStatus)
    : "pending";
}

export function buildResultEmailDeliveryNotice(status: ResultEmailDeliveryStatus): {
  tone: "success" | "info" | "error";
  title: string;
  text: string;
} {
  if (status === "sent") {
    return {
      tone: "success",
      title: "診断結果メールを送信しました",
      text: "入力された医院代表メールアドレスへ、この結果ページのURLをお送りしました。",
    };
  }
  if (status === "failed") {
    // 2026-09-22最終修正: 利用者が対応できないシステム起因のメール送信失敗を、
    // ファーストビュー最上部の赤い警告として強く見せない。主メッセージは
    // 利用者が実際に取れる行動(URL保存)にし、メール未達の事実は控えめに添える。
    return {
      tone: "info",
      title: "このページのURLを保存してください",
      text: "診断結果メールを送信できなかったため、このページで結果をご確認ください。",
    };
  }
  if (status === "disabled") {
    return {
      tone: "info",
      title: "診断結果メールは現在準備中です",
      text: "診断結果はこのページで確認できます。再確認できるよう、このページのURLを保存してください。",
    };
  }
  return {
    tone: "info",
    title: "診断結果メールを確認しています",
    text: "送信処理の状態を確認中です。診断結果はこのページでそのまま確認できます。",
  };
}
