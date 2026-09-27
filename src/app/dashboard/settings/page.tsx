import Link from "next/link";
import { requireContact } from "@/server/auth/requireContact";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { getClinicProfile } from "@/server/db/clinicProfileRepository";
import { resolveBillingConfigFromProcessEnv } from "@/server/config/billingConfig";
import { resolveResultEmailConfigFromProcessEnv } from "@/server/config/resultEmailConfig";
import { buildSubscriptionViewModel } from "../subscriptionViewModel";
import { ClinicProfileForm } from "./ClinicProfileForm";
import styles from "./settings.module.css";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";

export const metadata = { title: "設定・連携 | DENT SHIFT" };

type Tone = "ok" | "info" | "warn" | "neutral";
function badgeClass(tone: Tone) {
  if (tone === "ok") return `${styles.badge} ${styles.badgeOk}`;
  if (tone === "info") return `${styles.badge} ${styles.badgeInfo}`;
  if (tone === "warn") return `${styles.badge} ${styles.badgeWarn}`;
  return styles.badge;
}

// 実接続は未提供。誤解を避けるため「順次提供」と明示する。
const UPCOMING_INTEGRATIONS = ["Google Analytics 4(GA4)", "Search Console", "Googleビジネスプロフィール(GBP)連携", "LINE WORKS"];

export default async function SettingsPage() {
  const contact = await requireContact({ next: "/dashboard/settings" });
  const [profile, subscription] = await Promise.all([
    getClinicProfile(contact.clinicId),
    getLatestSubscriptionByClinicId(contact.clinicId),
  ]);

  let checkoutReady = false;
  try {
    checkoutReady = resolveBillingConfigFromProcessEnv().provider === "stripe";
  } catch {
    checkoutReady = false;
  }
  const subscriptionVm = buildSubscriptionViewModel(subscription, checkoutReady);

  let emailReady = false;
  try {
    emailReady = resolveResultEmailConfigFromProcessEnv().provider !== "disabled";
  } catch {
    emailReady = false;
  }

  const initial = {
    name: profile?.name ?? "",
    directorName: profile?.directorName ?? "",
    url: profile?.url ?? "",
    gbpUrl: profile?.gbpUrl ?? "",
    bookingUrl: profile?.bookingUrl ?? "",
    contactPhone: profile?.contactPhone ?? "",
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/dashboard" aria-label="ダッシュボードへ戻る">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.logo}
            src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
          />
        </Link>
        <Link className={styles.headerLink} href="/dashboard">ダッシュボードへ戻る</Link>
      </header>

      <section className={styles.title}>
        <h1>設定・連携</h1>
        <p>医院情報の確認・更新と、ご契約・連携の状態を確認できます。</p>
      </section>

      <div className={styles.stack}>
        <section className={styles.card} aria-labelledby="clinic-info">
          <h2 id="clinic-info">医院情報</h2>
          <p className={styles.cardNote}>
            診断・レポートに使われる情報です。保存後の診断から反映されます。
          </p>
          <ClinicProfileForm initial={initial} />
        </section>

        <section className={styles.card} aria-labelledby="contract-info">
          <h2 id="contract-info">ご契約</h2>
          <p className={styles.cardNote}>ご契約の状態です(この画面では変更できません)。</p>
          <ul className={styles.list}>
            <li className={styles.row}>
              <span className={styles.rowLabel}>プラン</span>
              <span>{subscriptionVm.planName}</span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>状態</span>
              <span className={badgeClass(subscriptionVm.tone === "positive" ? "ok" : subscriptionVm.tone === "info" ? "info" : subscriptionVm.tone === "neutral" ? "neutral" : "warn")}>
                {subscriptionVm.statusLabel}
              </span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>プラン・お支払いの管理</span>
              <Link className={styles.link} href="/dashboard#subscription">契約状況へ</Link>
            </li>
          </ul>
        </section>

        <section className={styles.card} aria-labelledby="account-info">
          <h2 id="account-info">アカウント</h2>
          <p className={styles.cardNote}>ログイン中のアカウントの状態です(この画面では変更できません)。</p>
          <ul className={styles.list}>
            <li className={styles.row}>
              <span className={styles.rowLabel}>ログインメールアドレス</span>
              <span>{contact.email}</span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>メールアドレスの確認</span>
              <span className={badgeClass(contact.emailVerifiedAt ? "ok" : "warn")}>
                {contact.emailVerifiedAt ? "確認済み" : "未確認"}
              </span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>携帯電話番号の認証</span>
              <span className={badgeClass(contact.phoneVerifiedAt ? "ok" : contact.smsVerificationExempt ? "info" : "warn")}>
                {contact.phoneVerifiedAt ? "認証済み" : contact.smsVerificationExempt ? "認証不要" : "未認証"}
              </span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>パスワード</span>
              <Link className={styles.link} href="/forgot-password">パスワードを再設定する</Link>
            </li>
          </ul>
        </section>

        <section className={styles.card} aria-labelledby="integration-info">
          <h2 id="integration-info">外部連携</h2>
          <p className={styles.cardNote}>現在の連携状態です(この画面では変更できません)。</p>
          <ul className={styles.list}>
            <li className={styles.row}>
              <span className={styles.rowLabel}>診断結果メール</span>
              <span className={badgeClass(emailReady ? "ok" : "neutral")}>{emailReady ? "利用中" : "準備中"}</span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowLabel}>カード決済(Stripe)</span>
              <span className={badgeClass(checkoutReady ? "ok" : "neutral")}>{checkoutReady ? "利用中" : "準備中"}</span>
            </li>
            {UPCOMING_INTEGRATIONS.map((name) => (
              <li key={name} className={styles.row}>
                <span className={styles.rowLabel}>{name}</span>
                <span className={badgeClass("neutral")}>順次提供</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <SupportPhoneFooter />
    </main>
  );
}
