"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { validateOperatorPassword } from "@/domain/auth/operatorPassword";
import styles from "../ops.module.css";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "#B91C1C" }}>
        このリンクは無効です。
        <Link href="/ops/forgot-password" style={{ color: "#2563EB", marginLeft: 4 }}>
          もう一度パスワード再設定をお試しください
        </Link>
      </p>
    );
  }

  if (done) {
    return (
      <div>
        <p style={{ margin: 0, fontSize: 13, color: "#065F46", fontWeight: 700 }}>
          パスワードを再設定しました。新しいパスワードでログインしてください。
        </p>
        <button
          type="button"
          onClick={() => router.push("/ops/login")}
          className={styles.loginButton}
          style={{ marginTop: 16 }}
        >
          ログイン画面へ
        </button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("新しいパスワード(確認用)が一致しません");
      return;
    }
    const validation = validateOperatorPassword(newPassword);
    if (!validation.valid) {
      setError(validation.reason);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ops/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "再設定に失敗しました");
        return;
      }
      setDone(true);
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.loginForm}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>新しいパスワード(8文字以上、数字1文字以上、絵文字1文字以上)</span>
        <input
          className={styles.input}
          required
          type="password"
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>新しいパスワード(確認用)</span>
        <input
          className={styles.input}
          required
          type="password"
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.loginButton} type="submit" disabled={submitting}>
        {submitting ? "変更中..." : "パスワードを再設定する"}
      </button>
    </form>
  );
}
