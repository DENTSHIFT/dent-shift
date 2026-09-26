import Link from "next/link";
import { getCurrentContact } from "@/server/auth/session";
import { PLAN_FEATURE_ROWS, PLAN_SUMMARIES, type PlanId } from "@/domain/billing/planCatalog";
import { PLAN_PRICE_LABELS } from "@/domain/billing/planPricing";
import {
  BillingConfigError,
  resolveBillingConfigFromProcessEnv,
  type BillingConfig,
} from "@/server/config/billingConfig";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { hasExistingSubscription as subscriptionBlocksNewCheckout } from "@/domain/billing/subscriptionStatus";
import { evaluateUpgrade } from "@/domain/billing/planUpgrade";
import { UpgradeButton } from "@/components/UpgradeButton";
import styles from "./plans.module.css";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";

function safeBillingConfig(): { config: BillingConfig; configurationError: boolean } {
  try {
    return { config: resolveBillingConfigFromProcessEnv(), configurationError: false };
  } catch (error) {
    if (error instanceof BillingConfigError) {
      return {
        config: {
          provider: "disabled",
          priceLabels: PLAN_PRICE_LABELS,
        },
        configurationError: true,
      };
    }
    throw error;
  }
}

function PlanAction({
  plan,
  checkoutReady,
  authenticated,
  isBillingExempt,
  hasExistingSubscription,
  currentPlan,
  upgradeAllowed,
}: {
  plan: PlanId;
  currentPlan: PlanId | null;
  upgradeAllowed: boolean;
  checkoutReady: boolean;
  authenticated: boolean;
  isBillingExempt: boolean;
  hasExistingSubscription: boolean;
}) {
  // 2026-09-24: 永久無料の特別アカウント(billingExempt)には、Stripe決済へ進む
  // CTAを一切出さない(すでに無期限で有効な契約があり、購入操作自体が不要かつ
  // Stripe側に対応する契約が存在しないため実行してもエラーになる)。
  if (isBillingExempt) {
    return <span className={styles.disabledAction}>永久無料でご利用中です</span>;
  }
  // 2026-09-23: 二重契約・二重課金防止。既にactive/trial/past_due等の契約がある
  // クリニックには新規Checkoutへの導線を出さない(APIも別途ガード済み、画面側だけに
  // 依存しない)。プラン変更・解約はダッシュボードのCustomer Portal導線を案内する。
  if (hasExistingSubscription) {
    if (plan === currentPlan) {
      return <span className={styles.disabledAction}>現在のプラン</span>;
    }
    // 上位プランへのアップグレードのみ。ダウングレードや価格の自由指定は受け付けない。
    if (upgradeAllowed && (plan === "standard" || plan === "premium")) {
      return (
        <UpgradeButton
          targetPlan={plan}
          className={styles.action}
          label="アップグレード"
          confirmMessage="このプランへアップグレードします。トライアル期間は変わりません。有効な契約の場合は差額が請求されます。よろしいですか?"
        />
      );
    }
    return <span className={styles.disabledAction}>ご契約中(プラン変更はダッシュボードから)</span>;
  }
  if (!checkoutReady) {
    return <span className={styles.disabledAction}>オンライン契約は準備中</span>;
  }
  if (!authenticated) {
    return (
      <Link className={styles.action} href="/login">
        ログインして契約へ進む
      </Link>
    );
  }
  return (
    <form action="/api/billing/checkout" method="post">
      <input type="hidden" name="plan" value={plan} />
      <button className={styles.action} type="submit">
        このプランで契約へ進む
      </button>
    </form>
  );
}

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [{ checkout }, currentContact] = await Promise.all([searchParams, getCurrentContact()]);
  const { config, configurationError } = safeBillingConfig();
  const checkoutReady = config.provider === "stripe";
  const subscription = currentContact
    ? await getLatestSubscriptionByClinicId(currentContact.clinicId)
    : null;
  const isBillingExempt = subscription?.billingExempt === true;
  const hasExistingSubscription = !isBillingExempt && subscriptionBlocksNewCheckout(subscription);

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
        {currentContact ? (
          <Link className={styles.headerLink} href="/dashboard">ダッシュボードへ戻る</Link>
        ) : (
          <Link className={styles.headerLink} href="/login">ログイン</Link>
        )}
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>DENT SHIFT プラン比較</p>
        <h1>医院の改善ペースに合うプランを選ぶ</h1>
        <p>
          営業電話や商談を必須にせず、料金・契約条件を確認してからオンラインで申し込めます。
        </p>
      </section>

      {checkout === "cancelled" && (
        <div className={styles.infoBanner}>決済は完了していません。プランをもう一度確認できます。</div>
      )}

      {hasExistingSubscription && (
        <div className={styles.infoBanner}>
          既にご契約中です。プランの変更・解約はダッシュボードから行えます。
        </div>
      )}

      {!checkoutReady && (
        <div className={styles.notice}>
          <strong>オンライン契約は現在準備中です。</strong>
          <span>
            表示料金を確認できますが、カード入力や請求はまだ始まりません。
            {configurationError ? " 設定内容にも確認が必要です。" : ""}
          </span>
        </div>
      )}

      <section className={styles.cards} aria-label="プラン一覧">
        {PLAN_SUMMARIES.map((plan) => (
          <article
            className={`${styles.card} ${plan.recommended ? styles.recommended : ""}`}
            key={plan.id}
          >
            {plan.recommended && <span className={styles.recommendedBadge}>おすすめ</span>}
            <h2>{plan.name}</h2>
            <p className={styles.description}>{plan.description}</p>
            <p className={styles.price}>
              {config.priceLabels[plan.id]}
            </p>
            <ul>
              {plan.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
            </ul>
            <PlanAction
              plan={plan.id}
              checkoutReady={checkoutReady}
              authenticated={Boolean(currentContact)}
              isBillingExempt={isBillingExempt}
              hasExistingSubscription={hasExistingSubscription}
              currentPlan={subscription?.plan ?? null}
              upgradeAllowed={
                subscription
                  ? evaluateUpgrade({
                      currentPlan: subscription.plan,
                      status: subscription.status,
                      billingExempt: subscription.billingExempt,
                      invited: subscription.inviteId !== null,
                      targetPlan: plan.id,
                    }).ok
                  : false
              }
            />
          </article>
        ))}
      </section>

      <section className={styles.comparison}>
        <h2>機能比較</h2>
        <p>具体的な質問数・測定頻度は、API原価と実医院テスト後に最終決定します。</p>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>機能</th>
                <th>ライトプラン</th>
                <th>スタンダードプラン</th>
                <th>プレミアムプラン</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_FEATURE_ROWS.map((row) => (
                <tr key={row.feature}>
                  <th>{row.feature}</th>
                  <td>{row.light}</td>
                  <td>{row.standard}</td>
                  <td>{row.premium}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.assurance}>
        <h2>契約前に必ず確認できること</h2>
        <div>
          <p><strong>料金</strong><span>月額は税込で表示し、初期費用も明示</span></p>
          <p><strong>契約条件</strong><span>契約期間・更新方法・解約条件を明示</span></p>
          <p><strong>お支払い</strong><span>カード番号はDENT SHIFTでは保存しません</span></p>
        </div>
      </section>
      <SupportPhoneFooter />
    </main>
  );
}
