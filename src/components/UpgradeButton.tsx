"use client";

import { useRef, useState } from "react";

export function UpgradeButton({
  targetPlan,
  label,
  className,
  confirmMessage,
}: {
  targetPlan: "standard" | "premium";
  label: string;
  className?: string;
  confirmMessage: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function handleClick() {
    if (inFlight.current) return;
    if (!window.confirm(confirmMessage)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlan }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "プランを変更できませんでした。");
        inFlight.current = false;
        setBusy(false);
        return;
      }
      // DBのプラン反映はStripeのWebhook経由のため、数秒後に最新の状態を読み込む。
      window.setTimeout(() => window.location.assign("/dashboard#subscription"), 3000);
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div>
      <button className={className} type="button" onClick={handleClick} disabled={busy}>
        {busy ? "プランを変更しています…" : label}
      </button>
      {error && <p role="alert" style={{ color: "#dc2626", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
