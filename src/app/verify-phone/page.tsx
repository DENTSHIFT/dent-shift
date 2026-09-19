import { redirect } from "next/navigation";
import { requireContact } from "@/server/auth/requireContact";
import { VerifyPhoneForm } from "./VerifyPhoneForm";

/**
 * SMS OTP認証ステップ(registrationStep==="sms")。携帯電話番号を必須にし、
 * 固定電話は/api/auth/phone/sendのバリデーション(normalizeJapanesePhoneNumberToE164)で
 * 明示エラーにする。ここからDENT SHIFTが営業電話をかけることは一切ない旨を明示する
 * (最重要原則: 営業マン0人・営業電話なし)。
 */
export default async function VerifyPhonePage() {
  const contact = await requireContact();
  if (contact.phoneVerifiedAt) {
    redirect("/dashboard");
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22 }}>携帯電話番号の確認</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
        なりすまし登録を防ぐため、携帯電話番号のSMS認証をお願いしています。
      </p>
      <VerifyPhoneForm />
    </main>
  );
}
