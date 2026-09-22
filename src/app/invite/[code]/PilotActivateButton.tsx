"use client";

import { useState } from "react";

const BLUE = "#2563EB";

export function PilotActivateButton({
  inviteCode,
  requireEmailMatch,
  inviteEmail,
  currentEmail,
}: {
  inviteCode: string;
  requireEmailMatch: boolean;
  inviteEmail: string;
  currentEmail: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailMismatch =
    requireEmailMatch && currentEmail.toLowerCase() !== inviteEmail.toLowerCase();

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${inviteCode}/pilot-activate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "パイロット利用を開始できませんでした。");
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  if (emailMismatch) {
    return (
      <p style={{ fontSize: 13, color: "#B91C1C", lineHeight: 1.6 }}>
        この招待は招待先メールアドレス宛です。招待メールに記載のメールアドレスでログインしてから、もう一度お試しください。
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        style={{
          width: "100%",
          minHeight: 44,
          padding: "11px 18px",
          border: 0,
          borderRadius: 9,
          color: "#fff",
          background: BLUE,
          fontSize: 13,
          fontWeight: 750,
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "準備中…" : "限定プランでDENT SHIFTを試す"}
      </button>
      {error && <p style={{ fontSize: 12, color: "#B91C1C", margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}
