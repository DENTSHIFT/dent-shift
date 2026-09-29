"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OTP_CODE_HINT, OTP_CODE_MAX_LENGTH, OTP_INVALID_FORMAT_MESSAGE, OTP_LOOKS_LIKE_PHONE_MESSAGE, validateOtpCode } from "@/domain/auth/otpCode";
import styles from "../auth.module.css";

type Method = "email" | "sms";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [method, setMethod] = useState<Method | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [codeStage, setCodeStage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, payload: Record<string, string>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, data: (await res.json()) as { message?: string; error?: string; token?: string } };
  }

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!method) return;
    setSubmitting(true);
    setError(null);
    try {
      const path = method === "email" ? "/api/auth/password-reset/email" : "/api/auth/password-reset/sms/send";
      const { ok, data } = await post(path, { email });
      if (!ok) {
        setError(data.error ?? "送信に失敗しました");
        return;
      }
      setNotice(data.message ?? null);
      if (method === "sms") setCodeStage(true);
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const checked = validateOtpCode(code);
    if (!checked.ok) {
      setError(checked.reason === "phone_like" ? OTP_LOOKS_LIKE_PHONE_MESSAGE : OTP_INVALID_FORMAT_MESSAGE);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { ok, data } = await post("/api/auth/password-reset/sms/verify", { email, code });
      if (!ok || !data.token) {
        setError(data.error ?? "認証コードを確認できませんでした");
        return;
      }
      router.replace(`/reset-password?token=${encodeURIComponent(data.token)}`);
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  if (!method) {
    return (
      <div className={styles.form}>
        <button className={styles.primaryButton} type="button" onClick={() => setMethod("email")}>
          メールで再設定
        </button>
        <button className={styles.primaryButton} type="button" onClick={() => setMethod("sms")}>
          SMSで再設定
        </button>
        <p className={styles.switchLink}>
          <Link href="/login">ログイン画面へ戻る</Link>
        </p>
      </div>
    );
  }

  if (method === "email" && notice) {
    return (
      <div className={styles.form}>
        <p className={styles.description}>{notice}</p>
        <p className={styles.switchLink}>
          <Link href="/login">ログイン画面へ戻る</Link>
        </p>
      </div>
    );
  }

  if (method === "sms" && codeStage) {
    return (
      <form onSubmit={handleVerify} className={styles.form}>
        {notice && <p className={styles.description}>{notice}</p>}
        <label className={styles.field}>
          <span>認証コード</span>
          <input className={styles.input} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={OTP_CODE_MAX_LENGTH} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
          <span className={styles.fieldHelper}>{OTP_CODE_HINT}</span>
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.primaryButton} type="submit" disabled={submitting}>
          {submitting ? "確認中..." : "認証コードを確認"}
        </button>
        <p className={styles.helper}>
          SMSが届かない場合は、登録済みの携帯電話番号がないか、受信できない状態の可能性があります。メールでの再設定もご利用いただけます。
        </p>
        <p className={styles.switchLink}>
          <a href="#" onClick={(e) => { e.preventDefault(); setCodeStage(false); setNotice(null); setCode(""); setError(null); }}>
            認証コードを再送する
          </a>
          {" / "}
          <a href="#" onClick={(e) => { e.preventDefault(); setMethod("email"); setCodeStage(false); setNotice(null); setCode(""); setError(null); }}>
            メールで再設定する
          </a>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={handleRequest} className={styles.form}>
      <label className={styles.field}>
        <span>登録メールアドレス</span>
        <input
          className={styles.input}
          required
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value.trim());
            if (error) setError(null);
          }}
          onInvalid={(e) => {
            e.preventDefault();
            setError(
              e.currentTarget.validity.valueMissing
                ? "メールアドレスを入力してください"
                : "メールアドレスの形式が正しくありません。コピー&ペースト時に不要な文字が含まれていないかご確認ください"
            );
          }}
        />
      </label>
      {method === "sms" && (
        <p className={styles.description}>
          SMSで再設定する場合も、入力するのはメールアドレスのみです。登録済みの携帯電話番号へ認証コードを送信します。
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.primaryButton} type="submit" disabled={submitting}>
        {submitting ? "送信中..." : method === "email" ? "再設定メールを送信" : "認証コードを送信"}
      </button>
      <p className={styles.switchLink}>
        <a href="#" onClick={(e) => { e.preventDefault(); setMethod(null); setError(null); }}>
          再設定方法を選び直す
        </a>
      </p>
    </form>
  );
}
