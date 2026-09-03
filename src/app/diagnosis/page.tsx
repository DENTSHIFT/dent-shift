"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DiagnosisPage() {
  const router = useRouter();
  const [clinicName, setClinicName] = useState("");
  const [clinicUrl, setClinicUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [gbpUrl, setGbpUrl] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicName, clinicUrl, contactEmail, gbpUrl, bookingUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "診断に失敗しました");
        return;
      }
      router.push(`/diagnosis/result/${data.diagnosisId}`);
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22 }}>無料AI集患診断</h1>
      <p style={{ color: "#888", fontSize: 13 }}>
        電話番号の入力は不要です。営業電話は一切ありません。
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
        <Field label="医院名 *">
          <input required value={clinicName} onChange={(e) => setClinicName(e.target.value)} />
        </Field>
        <Field label="公式サイトURL *">
          <input
            required
            type="url"
            placeholder="https://example-clinic.jp"
            value={clinicUrl}
            onChange={(e) => setClinicUrl(e.target.value)}
          />
        </Field>
        <Field label="メールアドレス *">
          <input
            required
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </Field>
        <Field label="GoogleビジネスプロフィールURL(任意)">
          <input value={gbpUrl} onChange={(e) => setGbpUrl(e.target.value)} />
        </Field>
        <Field label="Web予約URL(任意)">
          <input value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} />
        </Field>

        {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            background: "#2563eb",
            color: "#fff",
            padding: "12px 24px",
            borderRadius: 8,
            border: "none",
            fontWeight: 600,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "診断中..." : "診断する"}
        </button>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
      <span style={{ color: "#333" }}>{label}</span>
      <span
        style={{
          display: "block",
        }}
      >
        {children}
      </span>
      <style jsx>{`
        input {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 14px;
        }
      `}</style>
    </label>
  );
}
