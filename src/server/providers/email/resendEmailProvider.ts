import "server-only";
import type { DiagnosisResultEmailMessage } from "@/domain/email/diagnosisResultEmail";

export class ResultEmailDeliveryError extends Error {}

export async function sendWithResend(input: {
  apiKey: string;
  from: string;
  to: string;
  message: DiagnosisResultEmailMessage;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.message.subject,
        text: input.message.text,
        html: input.message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // API key・宛先・レスポンス本文を例外へ含めず、上位ログからの情報漏えいを防ぐ。
    throw new ResultEmailDeliveryError("Result email provider request failed.");
  }

  if (!response.ok) {
    // provider response bodyには入力値が含まれる可能性があるため読み取らない。
    throw new ResultEmailDeliveryError(
      `Result email provider returned HTTP ${response.status}.`
    );
  }
}
