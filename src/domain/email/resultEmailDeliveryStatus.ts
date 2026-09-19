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
    return {
      tone: "error",
      title: "診断結果メールを送信できませんでした",
      text: "診断結果はこのページで確認できます。再確認できるよう、このページのURLを保存してください。",
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
