"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = "enter-phone" | "enter-code";

export function VerifyPhoneForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("enter-phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "送信に失敗しました");
        return;
      }
      setStep("enter-code");
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "確認に失敗しました");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "enter-code") {
    return (
      <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
        <Field label="確認コード *">
          <input
            required
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <p style={{ fontSize: 13, color: "#888" }}>{phoneNumber} 宛にSMSを送信しました。</p>

        {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}

        <button type="submit" disabled={submitting} style={buttonStyle(submitting)}>
          {submitting ? "確認中..." : "確認する"}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("enter-phone");
            setError(null);
          }}
          style={{ background: "none", border: "none", color: "#2563eb", fontSize: 13, cursor: "pointer" }}
        >
          電話番号を変更する
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSend} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
      <Field label="携帯電話番号 *(営業電話は一切致しません)">
        <input
          required
          type="tel"
          inputMode="tel"
          placeholder="090-1234-5678"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
        />
      </Field>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: -8 }}>
        携帯電話番号(070/080/090)のみご利用いただけます。固定電話番号は登録できません。
        SMS認証コードの送信のみに使用します。
      </p>

      {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}

      <button type="submit" disabled={submitting} style={buttonStyle(submitting)}>
        {submitting ? "送信中..." : "確認コードを送信する"}
      </button>
    </form>
  );
}

function buttonStyle(submitting: boolean): React.CSSProperties {
  return {
    background: "#2563eb",
    color: "#fff",
    padding: "12px 24px",
    borderRadius: 8,
    border: "none",
    fontWeight: 600,
    cursor: submitting ? "not-allowed" : "pointer",
    opacity: submitting ? 0.6 : 1,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
      <span style={{ color: "#333" }}>{label}</span>
      <span style={{ display: "block" }}>{children}</span>
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
