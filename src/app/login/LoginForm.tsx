"use client";

import { useRef, useState } from "react";
import styles from "../auth.module.css";

type LoginStatus = "idle" | "checking" | "redirecting";

const STATUS_MESSAGES: Record<Exclude<LoginStatus, "idle">, string> = {
  checking: "ログイン情報を確認しています…",
  redirecting: "ログインに成功しました。画面を切り替えています…",
};

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("checking");
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "ログインに失敗しました");
        setStatus("idle");
        inFlight.current = false;
        return;
      }
      // Cookie設定済みの成功後は、クライアント遷移(push+refresh)ではなくフルナビゲーションで
      // 確実に遷移する。成功時は遷移が終わるまでボタンを無効のまま維持する。
      setStatus("redirecting");
      window.location.assign(next ?? "/dashboard");
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
      setStatus("idle");
      inFlight.current = false;
    }
  }

  const busy = status !== "idle";

  return (
    <form onSubmit={handleSubmit} className={styles.form} aria-busy={busy}>
      <Field label="メールアドレス">
        <input className={styles.input} required type="email" autoComplete="username" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="パスワード">
        <input className={styles.input} required type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <p className={styles.switchLink}>
        <a href="/forgot-password">パスワードを忘れた方へ</a>
      </p>

      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.helper} role="status" aria-live="polite">
        {status !== "idle" ? STATUS_MESSAGES[status] : ""}
      </p>

      <button className={styles.primaryButton} type="submit" disabled={busy}>
        {status === "idle" ? "ログイン" : STATUS_MESSAGES[status]}
      </button>
      <p className={styles.switchLink}>
        アカウントをお持ちでない方は <a href="/signup">無料会員登録</a>
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
