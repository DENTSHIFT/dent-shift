"use client";

import { useState } from "react";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("新しいパスワード(確認用)が一致しません");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ops/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "変更に失敗しました");
        return;
      }
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "#065F46", fontWeight: 700 }}>
        パスワードを変更しました。次回ログインから新しいパスワードをご利用ください。
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 360 }}>
      <Field label="現在のパスワード">
        <input
          required
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          style={inputStyle}
          autoComplete="current-password"
        />
      </Field>
      <Field label="新しいパスワード(8文字以上)">
        <input
          required
          type="password"
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={inputStyle}
          autoComplete="new-password"
        />
      </Field>
      <Field label="新しいパスワード(確認用)">
        <input
          required
          type="password"
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={inputStyle}
          autoComplete="new-password"
        />
      </Field>

      {error && <p style={{ margin: 0, fontSize: 12, color: "#DC2626" }}>{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        style={{
          minHeight: 40,
          padding: "9px 16px",
          border: 0,
          borderRadius: 9,
          color: "#fff",
          background: "#2563EB",
          fontSize: 13,
          fontWeight: 700,
          cursor: submitting ? "default" : "pointer",
          width: "fit-content",
        }}
      >
        {submitting ? "変更中…" : "パスワードを変更する"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 38,
  padding: "8px 10px",
  border: "1px solid #DBE4EF",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 650, color: "#40506A" }}>
      <span>{label}</span>
      {children}
    </label>
  );
}
