"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IntegrationEventOpsFilter } from "@/server/db/integrationEventRepository";

interface Props {
  filter: IntegrationEventOpsFilter;
  matchedCount: number;
  limit: number;
}

/**
 * 一覧に表示中の絞り込み条件(status=failed等)に一致するイベントの一括再送。
 * 2段階方式: まずプレビュー(件数確認、DB変更なし)→確認operationを経て実行。
 * 連打防止のため、リクエスト中はボタンを無効化する。
 */
export function IntegrationEventBulkRetryPanel({ filter, matchedCount, limit }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const willReenqueue = Math.min(matchedCount, limit);

  async function handleBulkRetry() {
    if (pending || matchedCount === 0) return;
    const confirmed = window.confirm(
      `現在の絞り込み条件(failed状態)に一致する${matchedCount}件のうち、` +
        `${willReenqueue}件を再送します。よろしいですか？` +
        (matchedCount > limit ? `\n(上限は1回${limit}件のため、古い順に${limit}件のみ対象です)` : "")
    );
    if (!confirmed) return;

    setPending(true);
    setError(null);
    setResultMessage(null);
    try {
      const res = await fetch("/api/ops/integration-events/bulk-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: filter.eventType,
          clinicId: filter.clinicId,
          retryExhaustedOnly: filter.retryExhaustedOnly ?? false,
          createdFrom: filter.createdFrom?.toISOString(),
          createdTo: filter.createdTo?.toISOString(),
          confirm: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "一括再送に失敗しました");
        return;
      }
      setResultMessage(
        data.salesforceDisabled
          ? `${data.reenqueuedCount}件をpendingへ戻しました。${data.message}`
          : `${data.reenqueuedCount}件を再送しました。`
      );
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "10px 14px",
        border: "1px solid #fde68a",
        borderRadius: 10,
        background: "#fffbeb",
        marginBottom: 16,
        fontSize: 12,
      }}
    >
      <span style={{ color: "#92400e" }}>
        現在の条件(failed状態)に一致: <b>{matchedCount}件</b>
        {matchedCount > 0 && <> (今回対象: {willReenqueue}件)</>}
      </span>
      <button
        type="button"
        onClick={handleBulkRetry}
        disabled={pending || matchedCount === 0}
        style={{
          appearance: "none",
          padding: "7px 14px",
          border: "1px solid #f59e0b",
          borderRadius: 8,
          color: "#7c2d12",
          background: "#fef3c7",
          fontSize: 12,
          fontWeight: 700,
          cursor: pending || matchedCount === 0 ? "not-allowed" : "pointer",
          opacity: pending || matchedCount === 0 ? 0.6 : 1,
        }}
      >
        {pending ? "再送中…" : "この条件で一括再送"}
      </button>
      {error && <span style={{ color: "#dc2626" }}>{error}</span>}
      {resultMessage && <span style={{ color: "#065f46" }}>{resultMessage}</span>}
    </div>
  );
}
