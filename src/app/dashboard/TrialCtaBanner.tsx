import type { PlanId } from "@/domain/billing/planCatalog";
import type { DashboardTrialBannerState } from "@/domain/billing/trialEntitlement";
import { UpgradeButton } from "@/components/UpgradeButton";
import styles from "./dashboard.module.css";

/**
 * 2026-09-28追加(PO承認、P1-1)、2026-09-28修正(PO再指摘、GETの副作用化を解消):
 * ダッシュボードのメイン領域上部に、医院の状態に応じたトライアル/契約導線CTAを表示する。
 * resolveDashboardTrialBannerState()の結果だけを見て描画し(個別の条件分岐を重複させない)、
 * billingExemptの場合は何も表示しない(=固定枠自体を残さない)。
 * クリック計測は/api/dashboard/trial-ctaへの**POST**フォーム送信で行う(GETの副作用化を
 * 避ける。prefetch・先読み・クローラーがGETを叩いても記録されない)。サーバー側で
 * clinicIdをセッションから取得し、遷移先はsafeNextPathで検証する(TrialCtaButtonForm参照)。
 */
function TrialCtaButtonForm({ to, label }: { to: string; label: string }) {
  return (
    <form action="/api/dashboard/trial-cta" method="post">
      <input type="hidden" name="to" value={to} />
      <button className={styles.trialCtaButton} type="submit">
        {label}
      </button>
    </form>
  );
}

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
          <TrialCtaButtonForm to="/diagnosis" label="まずは無料診断を完了する" />
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
          <TrialCtaButtonForm to="/plans" label="まずは7日間無料で試す" />
        </section>
      );
    case "continue_session":
      return (
        <section className={styles.trialCtaBanner} aria-label="次のアクション">
          <div>
            <h2 className={styles.trialCtaHeading}>無料トライアルの手続きを続ける</h2>
          </div>
          <TrialCtaButtonForm to="/plans" label="無料トライアルの手続きを続ける" />
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
          <TrialCtaButtonForm to="/plans" label="プランを選んで改善を続ける" />
        </section>
      );
    case "manage_existing":
      // 同一ページ内のフラグメント遷移(サーバーへのリクエストが発生しない)なので
      // GETの副作用問題は生じない。POSTフォーム化は不要。
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
