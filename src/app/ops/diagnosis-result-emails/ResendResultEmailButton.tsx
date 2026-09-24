"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 結果メール送信に失敗した診断1件の手動再送ボタン。連打防止のため送信中は無効化する。
 */
export function ResendResultEmailButton({ diagnosisId }: { diagnosisId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    if (pending) return;
    if (!window.confirm("この診断の結果メールを再送しますか？")) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/diagnosis-result-emails/${diagnosisId}/resend`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "再送に失敗しました");
        return;
      }
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleResend}
        disabled={pending}
        style={{
          appearance: "none",
          padding: "5px 10px",
          border: "1px solid #bfdbfe",
          borderRadius: 6,
          color: "#1d4ed8",
          background: "#eff6ff",
          fontSize: 11,
          fontWeight: 700,
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "再送中…" : "再送する"}
      </button>
      {error && <p style={{ color: "#dc2626", fontSize: 10, marginTop: 4 }}>{error}</p>}
    </div>
  );
}
