import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22 }}>ログイン</h1>
      <LoginForm />
    </main>
  );
}
