import Link from "next/link";
import { requireContact } from "@/server/auth/requireContact";
import { withBookingRef } from "@/server/integration/bookingRef";
import { TimeRexEmbed } from "@/components/timerex/TimeRexEmbed";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";
import styles from "./consult.module.css";

/**
 * ダッシュボード・初期設定など、医院紐付けが必要な全てのTimeRex予約導線が
 * 遷移する共通ページ(2026-10-03)。TimeRexへの直接リンクではなく必ずこのページを
 * 経由させることで、ds_refを埋め込みウィジェットのurl_params経由で届ける構成に統一する
 * (ホスト型ページへの直接リンクではWebhookのevent.url_paramsに反映されないことを
 * 実機で確認済み)。
 */
export default async function ConsultPage() {
  const contact = await requireContact({ next: "/consult" });
  const rawBookingUrl = process.env.NEXT_PUBLIC_SPECIALIST_BOOKING_URL;
  const bookingUrl = rawBookingUrl ? withBookingRef(rawBookingUrl, contact.clinicId) : undefined;

  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/dashboard">← ダッシュボードへ戻る</Link>
      <h1 className={styles.title}>スペシャリストに相談する</h1>
      <p className={styles.lead}>無料・45分。ご予約には医院担当者の電話番号が必要です。</p>
      {bookingUrl ? (
        <TimeRexEmbed bookingUrl={bookingUrl} />
      ) : (
        <p className={styles.unavailable}>現在ご相談の予約受付を準備中です。</p>
      )}
      <SupportPhoneFooter />
    </main>
  );
}
