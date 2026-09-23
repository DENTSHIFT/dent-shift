"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../ops.module.css";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ops/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "送信に失敗しました");
        return;
      }
      setMessage(data.message);
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  if (message) {
    return (
      <div>
        <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.7 }}>{message}</p>
        <p style={{ margin: "16px 0 0", fontSize: 12 }}>
          <Link href="/ops/login" style={{ color: "#2563EB" }}>
            ログイン画面へ戻る
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={styles.loginForm}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>管理者メールアドレス</span>
        <input
          className={styles.input}
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.loginButton} type="submit" disabled={submitting}>
        {submitting ? "送信中..." : "再設定用のご案内を送信する"}
      </button>

      <p style={{ margin: "12px 0 0", fontSize: 12, textAlign: "center" }}>
        <Link href="/ops/login" style={{ color: "#2563EB" }}>
          ログイン画面へ戻る
        </Link>
      </p>
    </form>
  );
}
