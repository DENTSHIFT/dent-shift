"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateInviteForm() {
  const router = useRouter();
  const [clinicName, setClinicName] = useState("");
  const [email, setEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [campaign, setCampaign] = useState("");
  const [isPilot, setIsPilot] = useState(false);
  const [pilotDurationDays, setPilotDurationDays] = useState("28");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreatedUrl(null);
    try {
      const res = await fetch("/api/ops/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicName,
          email,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          // Pilotモード選択時は、自由入力によるcampaign値のミスを防ぐため
          // campaignを"pilot"に固定する(手入力欄は非表示にする)。
          campaign: isPilot ? "pilot" : campaign || undefined,
          pilotDurationDays: isPilot ? Number(pilotDurationDays) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "発行に失敗しました");
        return;
      }
      setCreatedUrl(`${window.location.origin}/invite/${data.inviteCode}`);
      setClinicName("");
      setEmail("");
      setExpiresAt("");
      setCampaign("");
      setIsPilot(false);
      setPilotDurationDays("28");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid #E5E9F0",
        borderRadius: 16,
        background: "#fff",
        padding: 20,
        boxShadow: "0 3px 12px rgba(15,27,45,.055)",
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 15, color: "#0F1B2D" }}>新規招待を発行</h2>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "#6B7280" }}>
        通常招待は月額1円・3か月・スタンダード相当機能で固定です(招待専用Priceのみ使用し、通常プランには影響しません)。
        下の「Pilot招待」をオンにすると、決済を一切発生させないパイロット先行利用として発行します。
      </p>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 480 }}>
        <Field label="対象医院名 *">
          <input
            required
            value={clinicName}
            onChange={(e) => setClinicName(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="対象メールアドレス *">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="URL有効期限(任意、未入力なら無期限)">
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 650,
            color: "#40506A",
            padding: "8px 10px",
            border: "1px solid #DBE4EF",
            borderRadius: 8,
            background: isPilot ? "#EFF6FF" : "#fff",
          }}
        >
          <input
            type="checkbox"
            checked={isPilot}
            onChange={(e) => setIsPilot(e.target.checked)}
          />
          <span>
            Pilot招待として発行する(決済不要・Stripeカード登録なし。<code>campaign</code>は自動的に
            <code>pilot</code>に設定されます)
          </span>
        </label>

        {isPilot ? (
          <Field label="パイロット利用日数(有効化から終了予定日までの日数)">
            <input
              type="number"
              min={1}
              required
              value={pilotDurationDays}
              onChange={(e) => setPilotDurationDays(e.target.value)}
              style={inputStyle}
            />
            <span style={{ fontSize: 11, color: "#6B7280" }}>
              目安: 2週間=14、3週間=21、4週間=28。3か月固定にせず、短い周期でフィードバックを
              取ることを推奨します(自動終了処理は未実装のため、期限到達後は運営側で手動停止が必要です)。
            </span>
          </Field>
        ) : (
          <Field label="キャンペーン区分(任意、例: founder-monitor)">
            <input value={campaign} onChange={(e) => setCampaign(e.target.value)} style={inputStyle} />
          </Field>
        )}

        {error && <p style={{ margin: 0, fontSize: 12, color: "#DC2626" }}>{error}</p>}
        {createdUrl && (
          <p style={{ margin: 0, fontSize: 12, color: "#065F46", wordBreak: "break-all" }}>
            発行しました: <code>{createdUrl}</code>
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            minHeight: 40,
            padding: "9px 16px",
            border: 0,
            borderRadius: 9,
            color: "#fff",
            background: "#2563EB",
            fontSize: 13,
            fontWeight: 700,
            cursor: submitting ? "default" : "pointer",
            width: "fit-content",
          }}
        >
          {submitting ? "発行中…" : "招待を発行する"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 38,
  padding: "8px 10px",
  border: "1px solid #DBE4EF",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 650, color: "#40506A" }}>
      <span>{label}</span>
      {children}
    </label>
  );
}
