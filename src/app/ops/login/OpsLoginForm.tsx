"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../ops.module.css";

export function OpsLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "ログインに失敗しました");
        return;
      }
      router.push("/ops/dashboard");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.loginForm}>
      <Field label="メールアドレス">
        <input className={styles.input} required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="パスワード">
        <input className={styles.input} required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>

      {error && <p className={styles.error}>{error}</p>}

      <button
        className={styles.loginButton}
        type="submit"
        disabled={submitting}
      >
        {submitting ? "確認中..." : "管理者としてログイン"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
