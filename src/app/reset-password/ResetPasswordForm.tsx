"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { validatePassword } from "@/domain/auth/passwordPolicy";
import styles from "../auth.module.css";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <p className={styles.error}>
        このリンクは無効です。<Link href="/forgot-password">もう一度パスワード再設定をお試しください</Link>
      </p>
    );
  }

  if (done) {
    return (
      <div className={styles.form}>
        <p className={styles.description}>パスワードを変更しました。新しいパスワードでログインしてください。</p>
        <button className={styles.primaryButton} type="button" onClick={() => router.push("/login")}>
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
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      setError(validation.reason);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password-reset/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = (await res.json()) as { error?: string };
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
    <form onSubmit={handleSubmit} className={styles.form}>
      <label className={styles.field}>
        <span>新しいパスワード</span>
        <input className={styles.input} required type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span>新しいパスワード(確認)</span>
        <input className={styles.input} required type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      </label>
      <p className={styles.description}>8文字以上、英字1文字以上、数字1文字以上を含めてください。</p>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.primaryButton} type="submit" disabled={submitting}>
        {submitting ? "変更中..." : "パスワードを変更"}
      </button>
    </form>
  );
}
