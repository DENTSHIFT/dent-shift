import { ForgotPasswordForm } from "./ForgotPasswordForm";
import styles from "../auth.module.css";
import { SupportPhoneFooter } from "@/components/SupportPhoneFooter";

export default function ForgotPasswordPage() {
  return (
    <main className={styles.shell}>
      <div>
        <section className={styles.card}>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.logo} src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png" alt="DENT SHIFT 歯科集患を、AIでシフトする。" />
          </div>
          <h1 className={styles.title}>パスワードを忘れた方へ</h1>
          <p className={styles.description}>パスワードの再設定方法を選んでください。</p>
          <ForgotPasswordForm />
        </section>
        <SupportPhoneFooter />
      </div>
    </main>
  );
}
