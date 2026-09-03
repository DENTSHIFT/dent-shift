"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "ログインに失敗しました");
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

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
      <Field label="メールアドレス">
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="パスワード">
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
        {submitting ? "ログイン中..." : "ログイン"}
      </button>
      <p style={{ fontSize: 13, color: "#888" }}>
        アカウントをお持ちでない方は <a href="/signup">無料会員登録</a>
      </p>
    </form>
  );
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
