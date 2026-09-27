import Link from "next/link";
import type { PlanId } from "@/domain/billing/planCatalog";
import type { DashboardTrialBannerState } from "@/domain/billing/trialEntitlement";
import { UpgradeButton } from "@/components/UpgradeButton";
import styles from "./dashboard.module.css";

/**
 * 2026-09-28追加(PO承認、P1-1): ダッシュボードのメイン領域上部に、医院の状態に応じた
 * トライアル/契約導線CTAを表示する。resolveDashboardTrialBannerState()の結果だけを
 * 見て描画し(個別の条件分岐を重複させない)、billingExemptの場合は何も表示しない。
 * クリックは/api/dashboard/trial-cta経由で計測してから遷移する(サーバー側で
 * clinicIdをセッションから取得、クライアントJSを増やさない)。
 */
export function TrialCtaBanner({
  state,
  nextPlan,
}: {
  state: DashboardTrialBannerState;
  // upgrade_availableの場合のみ使用する、実装済みアップグレード先のプラン。
  nextPlan?: PlanId;
}) {
  if (state.kind === "billing_exempt") return null;

  switch (state.kind) {
    case "no_diagnosis":
      return (
        <section className={styles.trialCtaBanner} aria-label="次のアクション">
          <div>
            <h2 className={styles.trialCtaHeading}>まずは無料診断を完了する</h2>
            <p className={styles.trialCtaBody}>
              無料AI集患診断で、現在のAI表示状況を確認できます。
            </p>
          </div>
          <Link
            className={styles.trialCtaButton}
            href="/api/dashboard/trial-cta?to=/diagnosis"
          >
            まずは無料診断を完了する
          </Link>
        </section>
      );
    case "trial_available":
      return (
        <section className={styles.trialCtaBanner} aria-label="次のアクション">
          <div>
            <h2 className={styles.trialCtaHeading}>診断結果を、7日間の無料トライアルで改善につなげる</h2>
            <p className={styles.trialCtaBody}>
              改善アクション、継続診断、利用可能な機能を7日間お試しいただけます。
            </p>
          </div>
          <Link className={styles.trialCtaButton} href="/api/dashboard/trial-cta?to=/plans">
            まずは7日間無料で試す
          </Link>
        </section>
      );
    case "continue_session":
      return (
        <section className={styles.trialCtaBanner} aria-label="次のアクション">
          <div>
            <h2 className={styles.trialCtaHeading}>無料トライアルの手続きを続ける</h2>
          </div>
          <Link className={styles.trialCtaButton} href="/api/dashboard/trial-cta?to=/plans">
            無料トライアルの手続きを続ける
          </Link>
        </section>
      );
    case "preparing":
      // 2026-09-28(PO指示): 押して重複Sessionを作らない。Checkout APIも409で
      // 重複を拒否するが、ここでは操作可能な導線自体を出さず準備中の表示に留める
      // (この状態は数秒〜数分で自然に解消する一時的なものであるため)。
      return (
        <section className={styles.trialCtaBanner} aria-label="次のアクション">
          <div>
            <h2 className={styles.trialCtaHeading}>手続きを準備中</h2>
            <p className={styles.trialCtaBody}>少し待って再度お試しください。</p>
          </div>
          <span className={styles.trialCtaButtonDisabled}>手続きを準備中</span>
        </section>
      );
    case "trial_consumed":
      return (
        <section className={styles.trialCtaBanner} aria-label="次のアクション">
          <div>
            <h2 className={styles.trialCtaHeading}>プランを選んで改善を続ける</h2>
          </div>
          <Link className={styles.trialCtaButton} href="/api/dashboard/trial-cta?to=/plans">
            プランを選んで改善を続ける
          </Link>
        </section>
      );
    case "manage_existing":
      return (
        <section className={styles.trialCtaBanner} aria-label="次のアクション">
          <div>
            <h2 className={styles.trialCtaHeading}>契約状況を確認する</h2>
          </div>
          <a className={styles.trialCtaButton} href="#subscription">
            契約状況を確認する
          </a>
        </section>
      );
    case "upgrade_available":
      if (!nextPlan) return null;
      return (
        <section className={styles.trialCtaBanner} aria-label="次のアクション">
          <div>
            <h2 className={styles.trialCtaHeading}>契約状況を確認する</h2>
          </div>
          <UpgradeButton
            targetPlan={nextPlan as "standard" | "premium"}
            className={styles.trialCtaButton}
            label="アップグレードする"
            confirmMessage="このプランへアップグレードします。トライアル期間は変わりません。有効な契約の場合は差額が請求されます。よろしいですか?"
          />
        </section>
      );
  }
}
