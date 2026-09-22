"use client";

import { useState } from "react";

const BORDER = "#E5E9F0";
const GREEN = "#059669";
const GREEN_BG = "#ECFDF5";

/**
 * ①自院で対応: 決済も生成も伴わない単純な意思表示トグル。マーク/解除のみ(状態機械なし)。
 */
export function SelfServeToggleButton({
  reportId,
  improvementActionKey,
  initiallyMarked,
}: {
  reportId: string;
  improvementActionKey: string;
  initiallyMarked: boolean;
}) {
  const [marked, setMarked] = useState(initiallyMarked);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setLoading(true);
    setError(null);
    const nextMarked = !marked;
    try {
      const res = await fetch("/api/improvement-actions/self-serve", {
        method: nextMarked ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, improvementActionKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "更新できませんでした。");
        return;
      }
      setMarked(nextMarked);
    } catch {
      setError("更新できませんでした。時間をおいて再度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        style={{
          background: marked ? GREEN_BG : "#fff",
          border: `1px solid ${marked ? GREEN : BORDER}`,
          color: marked ? GREEN : "#374151",
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 600,
          cursor: loading ? "default" : "pointer",
        }}
      >
        {marked ? "✓ 自院で対応する(記録済み)" : "自院で対応する"}
      </button>
      {error && <p style={{ fontSize: 11, color: "#B91C1C", margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
