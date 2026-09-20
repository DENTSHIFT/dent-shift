import { OpsLoginForm } from "./OpsLoginForm";

/**
 * 運営側(社内オペレーター)ログイン。医院側/login とは別ドメインの認証
 * (SECURITY.md「認証ドメインを2系統に分ける」)。Operatorアカウントは社内で個別発行する
 * ため、このページに新規登録導線は置かない。
 */
export default function OpsLoginPage() {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22 }}>管理者用ログイン</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
        社内オペレーター専用です。アカウントは個別発行されます。
      </p>
      <OpsLoginForm />
    </main>
  );
}
