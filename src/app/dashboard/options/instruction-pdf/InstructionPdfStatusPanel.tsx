"use client";

import { useEffect, useState } from "react";

const NAVY = "#0F1B2D";
const BLUE = "#2563EB";
const BORDER = "#E5E9F0";
const MUTED = "#6B7280";

type StatusResponse = {
  orderStatus: string;
  generationStatus: string | null;
  downloadable: boolean;
  lastError: string | null;
};

const TERMINAL_STATUSES = new Set([
  "available",
  "downloaded",
  "completed",
  "generation_failed",
  "cancelled",
  "expired",
  "refunded",
]);

const STATUS_LABELS: Record<string, string> = {
  draft: "準備中です",
  checkout_created: "決済手続き中です",
  payment_pending: "決済処理中です",
  paid: "決済が完了しました。生成を開始しています",
  included: "プランの無料枠を利用して生成を開始しています",
  generation_queued: "生成待ちです",
  generating: "指示書PDFを生成しています…",
  generated: "生成が完了しました",
  available: "ダウンロードできます",
  downloaded: "ダウンロード済みです(再ダウンロード可能)",
  completed: "完了しました",
  payment_failed: "決済に失敗しました。お手数ですが再度お試しください",
  generation_failed: "生成に失敗しました。お手数ですが再度お試しください",
  cancelled: "この注文はキャンセルされました",
  expired: "この決済は期限切れです",
};

export function InstructionPdfStatusPanel({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // pollGenerationRequestedはretry()がポーリングを再開させるためのトリガー(useEffectの依存に含める)。
  const [pollGeneration, setPollGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/options/instruction-pdf/${orderId}/status`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setError("状態を取得できませんでした。ページを再読み込みしてください。");
          return;
        }
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setStatus(data);
        if (!TERMINAL_STATUSES.has(data.orderStatus)) {
          timer = setTimeout(poll, 3000);
        }
      } catch {
        if (!cancelled) setError("状態を取得できませんでした。ページを再読み込みしてください。");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, pollGeneration]);

  async function retryGeneration() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/options/instruction-pdf/${orderId}/retry`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRetryError(data?.error ?? "再試行に失敗しました。");
        return;
      }
      // 状態が変わったはずなので、ポーリングを再開する。
      setPollGeneration((n) => n + 1);
    } catch {
      setRetryError("再試行に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setRetrying(false);
    }
  }

  async function revealPassword() {
    setRevealing(true);
    setPasswordError(null);
    try {
      const res = await fetch(`/api/options/instruction-pdf/${orderId}/password`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data?.error ?? "パスワードを取得できませんでした。");
        return;
      }
      setPassword(data.password);
    } catch {
      setPasswordError("パスワードを取得できませんでした。");
    } finally {
      setRevealing(false);
    }
  }

  if (error) {
    return <p style={{ color: "#B91C1C", fontSize: 14 }}>{error}</p>;
  }
  if (!status) {
    return <p style={{ color: MUTED, fontSize: 14 }}>状態を確認しています…</p>;
  }

  const label = STATUS_LABELS[status.orderStatus] ?? status.orderStatus;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: NAVY }}>{label}</p>

      {!status.downloadable && !TERMINAL_STATUSES.has(status.orderStatus) && (
        <div
          style={{
            width: 20,
            height: 20,
            border: `2px solid ${BORDER}`,
            borderTopColor: BLUE,
            borderRadius: "50%",
            animation: "ds-spin 0.8s linear infinite",
          }}
        />
      )}

      {status.orderStatus === "generation_failed" && (
        <div>
          {status.lastError && (
            <p style={{ fontSize: 12, color: MUTED, margin: "0 0 8px" }}>詳細: {status.lastError}</p>
          )}
          <button
            type="button"
            onClick={retryGeneration}
            disabled={retrying}
            style={{
              background: BLUE,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 600,
              cursor: retrying ? "default" : "pointer",
            }}
          >
            {retrying ? "再試行中…" : "もう一度生成する"}
          </button>
          {retryError && <p style={{ fontSize: 12, color: "#B91C1C", margin: "6px 0 0" }}>{retryError}</p>}
        </div>
      )}

      {status.downloadable && (
        <div style={{ display: "grid", gap: 10 }}>
          <a
            href={`/api/options/instruction-pdf/${orderId}/download`}
            style={{
              display: "inline-block",
              background: BLUE,
              color: "#fff",
              borderRadius: 8,
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
              width: "fit-content",
            }}
          >
            PDFをダウンロード
          </a>

          <div>
            {password ? (
              <p style={{ fontSize: 14, margin: 0 }}>
                PDFパスワード: <code style={{ fontWeight: 700 }}>{password}</code>
              </p>
            ) : (
              <button
                type="button"
                onClick={revealPassword}
                disabled={revealing}
                style={{
                  background: "#fff",
                  border: `1px solid ${BORDER}`,
                  color: NAVY,
                  borderRadius: 8,
                  padding: "8px 14px",
                  fontSize: 13,
                  cursor: revealing ? "default" : "pointer",
                }}
              >
                {revealing ? "取得中…" : "パスワードを表示"}
              </button>
            )}
            {passwordError && (
              <p style={{ fontSize: 12, color: "#B91C1C", margin: "6px 0 0" }}>{passwordError}</p>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes ds-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
