import { SignupForm } from "./SignupForm";
import styles from "../auth.module.css";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ clinicId?: string }>;
}) {
  const { clinicId } = await searchParams;

  return (
    <main className={styles.shell}>
      <section className={`${styles.card} ${styles.cardWide}`}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.logo} src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png" alt="DENT SHIFT 歯科集患を、AIでシフトする。" />
        </div>
        <h1 className={styles.title}>無料会員登録</h1>
        <p className={styles.description}>
          {clinicId
            ? "診断済みの医院をこのアカウントで管理できるようにします。"
            : "医院情報を登録してダッシュボードを利用できるようにします。"}
        </p>
        <SignupForm clinicId={clinicId} />
      </section>
    </main>
  );
}
