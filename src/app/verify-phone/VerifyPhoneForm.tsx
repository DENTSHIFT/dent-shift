"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../auth.module.css";

type Step = "enter-phone" | "enter-code";

export function VerifyPhoneForm({ next }: { next?: string }) {
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
      router.push(next ?? "/dashboard");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "enter-code") {
    return (
      <form onSubmit={handleVerify} className={styles.form}>
        <Field label="確認コード *">
          <input
            required
            className={styles.input}
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <p className={styles.sentNotice}>{phoneNumber} 宛にSMSを送信しました。</p>

        {error && <p className={styles.error}>{error}</p>}

        <button className={styles.primaryButton} type="submit" disabled={submitting}>
          {submitting ? "確認中..." : "確認する"}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("enter-phone");
            setError(null);
          }}
          className={styles.secondaryButton}
        >
          電話番号を変更する
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSend} className={styles.form}>
      <Field label="携帯電話番号 *(営業電話は一切致しません)">
        <input
          required
          className={styles.input}
          type="tel"
          inputMode="tel"
          placeholder="090-1234-5678"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
        />
      </Field>
      <p className={styles.helper}>
        携帯電話番号(070/080/090)のみご利用いただけます。固定電話番号は登録できません。
        SMS認証コードの送信のみに使用します。
      </p>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.primaryButton} type="submit" disabled={submitting}>
        {submitting ? "送信中..." : "確認コードを送信する"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}
