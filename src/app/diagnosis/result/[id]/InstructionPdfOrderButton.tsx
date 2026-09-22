"use client";

import { useState } from "react";

const BLUE = "#2563EB";
const BORDER = "#E5E9F0";

/**
 * 改善TOP3カードから「②制作会社へ依頼する」導線を起動するボタン。
 * 確定仕様: 制作会社向け修正指示書(3,300円税込・one-time。プラン無料枠があれば
 * 自動的に消費される)。他のオプション商品はまだ存在しないため、ここでは
 * この1商品のみを扱う。
 */
export function InstructionPdfOrderButton({
  reportId,
  improvementActionKey,
}: {
  reportId: string;
  improvementActionKey: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/options/instruction-pdf/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, improvementActionKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "注文を開始できませんでした。");
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      // 無料枠消費・既存注文の場合はcheckoutUrlがないため、状況確認ページへ遷移する。
      window.location.href = `/dashboard/options/instruction-pdf?orderId=${encodeURIComponent(
        data.orderId
      )}`;
    } catch {
      setError("注文を開始できませんでした。時間をおいて再度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        style={{
          background: "#fff",
          border: `1px solid ${BORDER}`,
          color: BLUE,
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 600,
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "処理中…" : "制作会社向け修正指示書を注文する(3,300円/無料枠あれば0円)"}
      </button>
      {error && <p style={{ fontSize: 11, color: "#B91C1C", margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
