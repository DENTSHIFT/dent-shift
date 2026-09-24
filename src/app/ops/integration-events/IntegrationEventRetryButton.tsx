"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * failed状態1件の手動再送ボタン。連打による多重送信を防ぐため、リクエスト中は
 * ボタン自体を無効化する(サーバー側のstatus:"failed"ガードと合わせた二重の防止策)。
 */
export function IntegrationEventRetryButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    if (pending) return;
    if (!window.confirm("このイベントを再送しますか？(retryCountは0にリセットされます)")) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/integration-events/${eventId}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "再送に失敗しました");
        return;
      }
      if (data.salesforceDisabled) {
        window.alert(data.message ?? "Salesforce未接続のため保留として保存されました。");
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
        onClick={handleRetry}
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
