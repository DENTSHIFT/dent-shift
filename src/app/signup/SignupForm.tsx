"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../auth.module.css";

export function SignupForm({
  clinicId,
  next,
  prefillEmail,
  prefillClinicName,
}: {
  clinicId?: string;
  next?: string;
  prefillEmail?: string;
  prefillClinicName?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  const [clinicName, setClinicName] = useState(prefillClinicName ?? "");
  const [clinicUrl, setClinicUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 診断フォーム(src/app/diagnosis/page.tsx)と同じ「重複候補を確認済みなら
  // 別データとして続行する」パターン。以前は確認手段が無く、エラー文言が
  // 存在しない導線を示す形になり登録が行き詰まっていた(2026-09-22の手動E2Eで発見)。
  const [duplicateConfirmPending, setDuplicateConfirmPending] = useState(false);

  async function submit(allowDuplicateClinic: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, clinicId, clinicName, clinicUrl, allowDuplicateClinic }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.code === "clinic_duplicate_candidate") {
          setDuplicateConfirmPending(true);
          setError(data.error ?? "登録に失敗しました");
          return;
        }
        setDuplicateConfirmPending(false);
        setError(data.error ?? "登録に失敗しました");
        return;
      }
      router.push(next ? `/verify-phone?next=${encodeURIComponent(next)}` : "/verify-phone");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submit(false);
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
            <input
              className={styles.input}
              required
              value={clinicName}
              onChange={(e) => {
                setClinicName(e.target.value);
                setDuplicateConfirmPending(false);
              }}
            />
          </Field>
          <Field label="公式サイトURL *">
            <input
              required
              className={styles.input}
              type="url"
              placeholder="https://example-clinic.jp"
              value={clinicUrl}
              onChange={(e) => {
                setClinicUrl(e.target.value);
                setDuplicateConfirmPending(false);
              }}
            />
            <span className={styles.fieldHelper}>
              医院のWebサイトをAI診断・分析するために使用します
            </span>
          </Field>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {duplicateConfirmPending ? (
        <button
          className={styles.primaryButton}
          type="button"
          disabled={submitting}
          onClick={() => void submit(true)}
        >
          {submitting ? "登録中..." : "別データとして登録を続ける"}
        </button>
      ) : (
        <button className={styles.primaryButton} type="submit" disabled={submitting}>
          {submitting ? "登録中..." : "登録する"}
        </button>
      )}
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
