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
import { isSubscriptionStatus } from "@/domain/billing/subscriptionStatus";
import { evaluateUpgrade } from "@/domain/billing/planUpgrade";
import { isTrialEligiblePlan } from "@/domain/billing/trialActivation";
import { resolvePlanActionState, type PlanActionState } from "@/domain/billing/trialEntitlement";
import { getClinicTrialCheckoutSnapshot } from "@/server/db/trialEntitlementRepository";
import { UpgradeButton } from "@/components/UpgradeButton";
import { PlanFeatureCellView } from "@/components/PlanFeatureCell";
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

// 2026-09-28全面修正(PO再指摘、CTA矛盾の解消): PlanActionはresolvePlanActionState()が
// 返す状態を機械的に描画するだけにする。「押すと409になるボタンを表示しない」ことを、
// 個別の条件分岐の重複ではなく単一の判別可能な状態(PlanActionState)の型で保証する。
function PlanAction({ plan, state }: { plan: PlanId; state: PlanActionState }) {
  switch (state.kind) {
    case "billing_exempt":
      return <span className={styles.disabledAction}>永久無料でご利用中です</span>;
    case "current_plan":
      return <span className={styles.disabledAction}>現在のプラン</span>;
    case "upgrade":
      return (
        <UpgradeButton
          targetPlan={state.targetPlan}
          className={styles.action}
          label="アップグレード"
          confirmMessage="このプランへアップグレードします。トライアル期間は変わりません。有効な契約の場合は差額が請求されます。よろしいですか?"
        />
      );
    // 2026-09-28修正(PO再指摘): 新規Checkoutを禁止する既存Subscription状態では、
    // 押すと409になるボタンを表示せず、契約状況の確認(ダッシュボード)へ誘導する。
    case "manage_existing":
      return (
        <Link className={styles.action} href="/dashboard">
          契約状況を確認する
        </Link>
      );
    case "checkout_not_ready":
      return <span className={styles.disabledAction}>オンライン契約は準備中</span>;
    case "login_required":
      // 2026-09-28追加(PO承認、P1-3): トライアル対象プランは「ログインして無料
      // トライアルへ」、対象外(Premium)は従来どおりの契約文言にする。
      return (
        <Link className={styles.action} href="/login">
          {isTrialEligiblePlan(plan) ? "ログインして無料トライアルへ" : "ログインして契約へ進む"}
        </Link>
      );
    case "start_trial":
    case "continue_session":
    case "preparing":
    case "contract":
    case "recontract": {
      const label: Record<typeof state.kind, string> = {
        start_trial: "7日間無料で試す",
        continue_session: "無料トライアルの手続きを続ける",
        preparing: "手続きを準備中",
        contract: "このプランで契約する",
        recontract: "このプランで再契約する",
      };
      return (
        <form action="/api/billing/checkout" method="post">
          <input type="hidden" name="plan" value={plan} />
          <button className={styles.action} type="submit">
            {label[state.kind]}
          </button>
        </form>
      );
    }
  }
}

function trialNoteFor(state: PlanActionState, isTrialPlan: boolean): string | null {
  switch (state.kind) {
    case "start_trial":
      return "7日間無料トライアル対象・カード登録が必要です・トライアル中は請求されません・キャンセルしない場合はトライアル終了後にこのプランの料金が発生します";
    case "continue_session":
      return "トライアルの手続きが完了していません・続きから再開できます";
    case "preparing":
      return "お手続きの準備をしています・少し待って再度お試しください";
    case "recontract":
      return "無料トライアルは既に利用済みのため、ご契約と同時に料金が発生します";
    case "contract":
      return isTrialPlan
        ? "無料トライアルは既に利用済みのため、ご契約と同時に料金が発生します"
        : "トライアル対象外のプランです・ご契約と同時に料金が発生します";
    default:
      // billing_exempt/current_plan/upgrade/manage_existing/checkout_not_ready/login_requiredは
      // トライアル関連の注記自体を表示しない(既存契約者に無関係な文言を出さない)。
      return null;
  }
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
  const subscriptionStatus =
    subscription && isSubscriptionStatus(subscription.status) ? subscription.status : null;
  // 2026-09-28修正(PO再指摘): 「既存契約あり」を表示用の単純なbooleanへ潰さず、
  // resolvePlanActionState()へSubscription状態そのものを渡す(CTA矛盾の再発防止)。
  const clinicTrialSnapshot = currentContact
    ? await getClinicTrialCheckoutSnapshot(currentContact.clinicId)
    : null;

  const hasBlockingSubscription =
    !isBillingExempt &&
    subscriptionStatus !== null &&
    subscriptionStatus !== "cancelled";

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

      {hasBlockingSubscription && (
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
        {PLAN_SUMMARIES.map((plan) => {
          const upgradeAllowed = subscription
            ? evaluateUpgrade({
                currentPlan: subscription.plan,
                status: subscription.status,
                billingExempt: subscription.billingExempt,
                invited: subscription.inviteId !== null,
                targetPlan: plan.id,
              }).ok
            : false;

          const state = resolvePlanActionState({
            plan: plan.id,
            currentPlan: subscription?.plan ?? null,
            authenticated: Boolean(currentContact),
            checkoutReady,
            isBillingExempt,
            subscriptionStatus,
            upgradeAllowed,
            clinic: clinicTrialSnapshot,
          });
          const note = trialNoteFor(state, plan.id === "light" || plan.id === "standard");
          // 2026-09-28追加(PO承認、P1-3): プラン上部で無料トライアル対象を一目で
          // 分かるようにする(価格の直上に表示)。「おすすめ」は既にこの文言に
          // 含めるため、右上リボンとは別枠で重複表示しない。
          const trialBadgeText =
            plan.id === "premium"
              ? "無料トライアル対象外／申込後すぐに利用開始"
              : plan.id === "standard"
                ? "7日間無料・おすすめ"
                : "7日間無料";

          return (
            <article className={styles.card} key={plan.id}>
              <h2>{plan.name}</h2>
              <p className={styles.description}>{plan.description}</p>
              <p
                className={
                  plan.id === "premium" ? styles.trialBadgeMuted : styles.trialBadge
                }
              >
                {trialBadgeText}
              </p>
              <p className={styles.price}>
                {config.priceLabels[plan.id]}
              </p>
              <ul>
                {plan.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
              </ul>
              {note && <p className={styles.trialNote}>{note}</p>}
              <PlanAction plan={plan.id} state={state} />
            </article>
          );
        })}
      </section>

      <section className={styles.comparison}>
        <h2>プラン別機能一覧</h2>
        <p>各プランで利用できる機能をご確認いただけます。現在実装済みの機能のみを掲載しています。</p>
        {/* 2026-09-28全面修正(PO承認、P1-4): category(common/differs/comingSoon)ごとに
            区分して表示する。現時点でプラン間に実際の差がある項目は「改善指示書PDFの
            無料枠」のみのため、無理に多数の○×を並べず、3区分に整理する(PO指示)。 */}
        {(["common", "differs", "comingSoon"] as const).map((category) => {
          const rows = PLAN_FEATURE_ROWS.filter((row) => row.category === category);
          if (rows.length === 0) return null;
          const heading =
            category === "common"
              ? "現在すべてのプランで使える機能"
              : category === "differs"
                ? "プランごとの差"
                : "順次提供予定(契約判断の材料にはまだなりません)";
          return (
            <div key={category} className={styles.tableWrap} style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>{heading}</h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">機能</th>
                    <th scope="col">ライトプラン</th>
                    <th scope="col">スタンダードプラン</th>
                    <th scope="col">プレミアムプラン</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.feature}>
                      <th scope="row">{row.feature}</th>
                      <td><PlanFeatureCellView cell={row.light} /></td>
                      <td><PlanFeatureCellView cell={row.standard} /></td>
                      <td><PlanFeatureCellView cell={row.premium} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
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
