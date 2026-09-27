"use client";

import { useRef, useState } from "react";
import type { ClinicProfileErrors, ClinicProfileField } from "@/domain/clinic/clinicProfile";
import styles from "./settings.module.css";

type Values = Record<ClinicProfileField, string>;
type Status = "idle" | "saving" | "saved" | "failed";

const FIELDS: Array<{
  name: ClinicProfileField;
  label: string;
  required?: boolean;
  type?: string;
  hint?: string;
  autoComplete?: string;
}> = [
  { name: "name", label: "医院名", required: true, autoComplete: "organization" },
  { name: "directorName", label: "院長名" },
  { name: "url", label: "WebサイトURL", required: true, type: "url", hint: "https:// から始まるURL" },
  { name: "gbpUrl", label: "GoogleビジネスプロフィールURL", type: "url", hint: "任意。https:// から始まるURL" },
  { name: "bookingUrl", label: "予約URL", type: "url", hint: "任意。https:// から始まるURL" },
  { name: "contactPhone", label: "連絡先電話番号", type: "tel", hint: "任意。例: 03-1234-5678", autoComplete: "tel" },
];

export function ClinicProfileForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState<Values>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ClinicProfileErrors>({});
  const inFlight = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("saving");
    setMessage(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/clinics/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fieldErrors?: ClinicProfileErrors;
      };
      if (!res.ok) {
        setFieldErrors(data.fieldErrors ?? {});
        setMessage(data.error ?? "保存できませんでした。");
        setStatus("failed");
        return;
      }
      setMessage("保存しました。");
      setStatus("saved");
    } catch {
      setMessage("通信エラーが発生しました。時間をおいて再度お試しください。");
      setStatus("failed");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      <div className={styles.grid}>
        {FIELDS.map((field) => {
          const error = fieldErrors[field.name];
          const id = `clinic-${field.name}`;
          return (
            <label key={field.name} className={styles.field} htmlFor={id}>
              <span>
                {field.label}
                {field.required && <span className={styles.required}> *</span>}
              </span>
              <input
                id={id}
                className={`${styles.input} ${error ? styles.inputError : ""}`}
                type={field.type ?? "text"}
                autoComplete={field.autoComplete}
                value={values[field.name]}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                disabled={status === "saving"}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
              />
              {field.hint && !error && <span className={styles.hint}>{field.hint}</span>}
              {error && (
                <p id={`${id}-error`} className={styles.fieldError} role="alert">
                  {error}
                </p>
              )}
            </label>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button className={styles.primaryButton} type="submit" disabled={status === "saving"}>
          {status === "saving" ? "保存中…" : "保存する"}
        </button>
        <span role="status" aria-live="polite">
          {status === "saved" && message && <p className={styles.success}>{message}</p>}
          {status === "failed" && message && <p className={styles.failure}>{message}</p>}
        </span>
      </div>
    </form>
  );
}
