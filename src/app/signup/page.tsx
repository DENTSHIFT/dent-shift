import { SignupForm } from "./SignupForm";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ clinicId?: string }>;
}) {
  const { clinicId } = await searchParams;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22 }}>無料会員登録</h1>
      <p style={{ color: "#888", fontSize: 13 }}>
        {clinicId
          ? "診断済みの医院をこのアカウントで管理できるようにします。"
          : "医院情報を登録してダッシュボードを利用できるようにします。"}
      </p>
      <SignupForm clinicId={clinicId} />
    </main>
  );
}
