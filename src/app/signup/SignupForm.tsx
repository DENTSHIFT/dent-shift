"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../auth.module.css";

export function SignupForm({ clinicId }: { clinicId?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [clinicUrl, setClinicUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, clinicId, clinicName, clinicUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登録に失敗しました");
        return;
      }
      router.push("/verify-phone");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field label="メールアドレス *">
        <input className={styles.input} required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="パスワード(8文字以上) *">
        <input
          required
          className={styles.input}
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {!clinicId && (
        <>
          <Field label="医院名 *">
            <input className={styles.input} required value={clinicName} onChange={(e) => setClinicName(e.target.value)} />
          </Field>
          <Field label="公式サイトURL *">
            <input
              required
              className={styles.input}
              type="url"
              placeholder="https://example-clinic.jp"
              value={clinicUrl}
              onChange={(e) => setClinicUrl(e.target.value)}
            />
          </Field>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.primaryButton} type="submit" disabled={submitting}>
        {submitting ? "登録中..." : "登録する"}
      </button>
      <p className={styles.switchLink}>
        すでにアカウントをお持ちの方は <a href="/login">ログイン</a>
      </p>
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
