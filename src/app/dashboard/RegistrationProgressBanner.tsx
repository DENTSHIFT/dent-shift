"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CARD_STYLE: React.CSSProperties = {
  background: "#EFF6FF",
  border: "1px solid #BFDBFE",
  borderRadius: 12,
  padding: "16px 20px",
  marginBottom: 20,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

/**
 * SMS認証(/verify-phone)に続く、メール確認・決済方法登録・規約同意の各ステップを
 * ダッシュボード上で案内する。全4条件(SMS+メール+規約同意+決済方法)が揃うまで
 * trial_started_atは設定されない(activateTrial.ts)。
 *
 * 2026-09-24: Pilot招待(永久無料含む)経由で既にactive/trialな契約が作成済みの場合、
 * registrationStepの機械的な進行だけを見ると"payment"のままになり得る
 * (activatePilotInvite.tsはregistrationStepを更新しないため)。この状態で
 * 「7日間無料トライアルの開始には決済方法の登録が必要です」という誤ったCTAを
 * 出さないよう、hasActiveSubscription===trueの間は決済案内バナーを抑制する。
 */
export type RegistrationBannerKind = "email" | "payment" | "consent" | "none";

/**
 * 表示するバナー種別を決める純粋関数(ロジックのみユニットテスト可能にするため分離)。
 */
export function resolveRegistrationBannerKind(
  registrationStep: string,
  hasActiveSubscription: boolean
): RegistrationBannerKind {
  if (registrationStep === "email") return "email";
  if (registrationStep === "payment") return hasActiveSubscription ? "none" : "payment";
  if (registrationStep === "consent") return "consent";
  return "none";
}

export function RegistrationProgressBanner({
  registrationStep,
  hasActiveSubscription,
}: {
  registrationStep: string;
  hasActiveSubscription: boolean;
}) {
  const kind = resolveRegistrationBannerKind(registrationStep, hasActiveSubscription);
  if (kind === "email") return <EmailStepBanner />;
  if (kind === "payment") return <PaymentStepBanner />;
  if (kind === "consent") return <ConsentStepBanner />;
  return null;
}

function EmailStepBanner() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleResend() {
    setStatus("sending");
    setMessage(null);
    try {
      const res = await fetch("/api/auth/verify-email/resend", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "再送に失敗しました");
        return;
      }
      setStatus("sent");
      setMessage(
        data.status === "disabled"
          ? "メール送信基盤が未設定のため、実際には送信されていません(開発環境)。"
          : "確認メールを再送しました。"
      );
    } catch {
      setStatus("error");
      setMessage("通信エラーが発生しました。時間をおいて再度お試しください。");
    }
  }

  return (
    <div style={CARD_STYLE}>
      <p style={{ margin: 0, fontWeight: 700, color: "#1E3A8A", fontSize: 14 }}>
        メールアドレスの確認をお願いします
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "#1E3A8A" }}>
        登録時のメールアドレス宛に確認メールを送信しました。メール内のリンクを開いて確認を完了してください。
      </p>
      <div>
        <button
          type="button"
          onClick={handleResend}
          disabled={status === "sending"}
          style={{
            background: "#2563EB",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: status === "sending" ? "not-allowed" : "pointer",
            opacity: status === "sending" ? 0.6 : 1,
          }}
        >
          {status === "sending" ? "送信中..." : "確認メールを再送する"}
        </button>
      </div>
      {message && <p style={{ margin: 0, fontSize: 12, color: status === "error" ? "#DC2626" : "#1E3A8A" }}>{message}</p>}
    </div>
  );
}

function PaymentStepBanner() {
  return (
    <div style={CARD_STYLE}>
      <p style={{ margin: 0, fontWeight: 700, color: "#1E3A8A", fontSize: 14 }}>
        決済方法の登録をお願いします
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "#1E3A8A" }}>
        7日間無料トライアルの開始には、プラン選択と決済方法の登録が必要です。トライアル中の請求は発生しません。
      </p>
      <div>
        <a
          href="/plans"
          style={{
            display: "inline-block",
            background: "#2563EB",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          プランを選ぶ
        </a>
      </div>
    </div>
  );
}

function ConsentStepBanner() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/consent/accept", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "処理に失敗しました");
        return;
      }
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={CARD_STYLE}>
      <p style={{ margin: 0, fontWeight: 700, color: "#1E3A8A", fontSize: 14 }}>
        利用規約・プライバシーポリシーへの同意をお願いします
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1E3A8A" }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        利用規約・プライバシーポリシーに同意します
      </label>
      <div>
        <button
          type="button"
          onClick={handleAccept}
          disabled={!agreed || submitting}
          style={{
            background: "#2563EB",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: !agreed || submitting ? "not-allowed" : "pointer",
            opacity: !agreed || submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "処理中..." : "同意して次へ"}
        </button>
      </div>
      {error && <p style={{ margin: 0, fontSize: 12, color: "#DC2626" }}>{error}</p>}
    </div>
  );
}
