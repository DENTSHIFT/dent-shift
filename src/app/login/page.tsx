import { LoginForm } from "./LoginForm";
import styles from "../auth.module.css";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";
import { safeNextPath } from "@/domain/auth/safeNextPath";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);

  return (
    <main className={styles.shell}>
      <div>
        <section className={styles.card}>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png" alt="DENT SHIFT 歯科集患を、AIでシフトする。" />
          </div>
          <h1 className={styles.title}>ログイン</h1>
          <p className={styles.description}>医院のAI集患状況と改善内容を確認できます。</p>
          <LoginForm next={safeNext ?? undefined} />
        </section>
        <SupportPhoneFooter />
      </div>
    </main>
  );
}
