import Link from "next/link";
import { requireContact } from "@/server/auth/requireContact";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { getDiagnosesByClinicId } from "@/server/db/diagnosisRepository";
import { buildOnboardingViewModel, type OnboardingStepState } from "./onboardingViewModel";
import styles from "./onboarding.module.css";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";

function stateClass(state: OnboardingStepState) {
  if (state === "complete") return `${styles.state} ${styles.complete}`;
  if (state === "current") return `${styles.state} ${styles.current}`;
  if (state === "attention") return `${styles.state} ${styles.attention}`;
  return `${styles.state} ${styles.pending}`;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [{ checkout }, contact] = await Promise.all([
    searchParams,
    requireContact({ next: "/onboarding" }),
  ]);
  const [subscription, diagnoses] = await Promise.all([
    getLatestSubscriptionByClinicId(contact.clinicId),
    getDiagnosesByClinicId(contact.clinicId),
  ]);
  const vm = buildOnboardingViewModel({
    subscription,
    hasDiagnosis: diagnoses.length > 0,
    latestDiagnosisId: diagnoses[0]?.id,
    checkoutJustCompleted: checkout === "success",
  });
  const bookingUrl = process.env.NEXT_PUBLIC_SPECIALIST_BOOKING_URL;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="DENT SHIFTトップへ戻る">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.logo}
            src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
          />
        </Link>
        <Link className={styles.headerLink} href="/dashboard">ダッシュボードへ</Link>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>初期設定</p>
        <h1>{vm.isComplete ? "初期設定が完了しました" : "利用開始までの準備を進めましょう"}</h1>
        <p>必要な項目は3つです。完了状況は自動で反映されます。</p>
        <div className={styles.progress} aria-label={`${vm.totalCount}項目中${vm.completedCount}項目完了`}>
          <span style={{ width: `${(vm.completedCount / vm.totalCount) * 100}%` }} />
        </div>
        <p className={styles.progressLabel}>{vm.completedCount} / {vm.totalCount} 完了</p>
      </section>

      {checkout === "success" && (
        <div className={styles.successBanner}>
          {vm.checkoutBannerMessage}
          <br />
          カード情報はStripeで安全に管理され、DENT SHIFTには保存されません。
        </div>
      )}

      <section className={styles.steps} aria-label="初期設定項目">
        {vm.steps.map((step, index) => (
          <article className={styles.step} key={step.key}>
            <span className={styles.stepNumber} aria-hidden="true">
              {step.state === "complete" ? "✓" : index + 1}
            </span>
            <div className={styles.stepBody}>
              <div className={styles.stepHeading}>
                <h2>{step.title}</h2>
                <span className={stateClass(step.state)}>{step.stateLabel}</span>
              </div>
              <p>{step.description}</p>
              {step.actionHref && step.actionLabel && (
                <Link className={styles.action} href={step.actionHref}>{step.actionLabel}</Link>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className={styles.optional}>
        <span className={styles.optionalBadge}>任意</span>
        <div>
          <h2>スペシャリストに相談する</h2>
          <p>初期設定や診断結果について45分相談できます。予約しなくても利用開始できます。</p>
        </div>
        {bookingUrl && (
          <a className={styles.secondaryAction} href={bookingUrl} target="_blank" rel="noreferrer">
            日程を選ぶ
          </a>
        )}
      </section>
      <SupportPhoneFooter />
    </main>
  );
}
