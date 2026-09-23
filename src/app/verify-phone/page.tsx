import { redirect } from "next/navigation";
import { requireContact } from "@/server/auth/requireContact";
import { VerifyPhoneForm } from "./VerifyPhoneForm";
import styles from "../auth.module.css";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";

/**
 * SMS OTP認証ステップ(registrationStep==="sms")。携帯電話番号を必須にし、
 * 固定電話は/api/auth/phone/sendのバリデーション(normalizeJapanesePhoneNumberToE164)で
 * 明示エラーにする。ここからDENT SHIFTが営業電話をかけることは一切ない旨を明示する
 * (最重要原則: 営業マン0人・営業電話なし)。
 */
/**
 * オープンリダイレクト対策: サイト内の絶対パス("/"始まり、"//"は除く)のみ許可する。
 */
function safeNextPath(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export default async function VerifyPhonePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);
  const contact = await requireContact();
  if (contact.phoneVerifiedAt) {
    redirect(safeNext ?? "/dashboard");
  }

  return (
    <main className={styles.shell}>
      <div>
        <section className={styles.card}>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png" alt="DENT SHIFT 歯科集患を、AIでシフトする。" />
          </div>
          <h1 className={styles.title}>携帯電話番号の確認</h1>
          <p className={styles.description}>
            なりすまし登録を防ぐため、携帯電話番号のSMS認証をお願いしています。
          </p>
          <VerifyPhoneForm next={safeNext ?? undefined} />
        </section>
        <SupportPhoneFooter />
      </div>
    </main>
  );
}
