import { NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";

/**
 * 再診断フォームへ、現在ログイン中の医院情報だけを返す。
 * セッショントークン・パスワードハッシュ・内部IDはレスポンスへ含めない。
 */
export async function GET() {
  const contact = await getCurrentContact();
  if (!contact) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    clinicName: contact.clinic.name,
    directorName: contact.clinic.directorName,
    clinicUrl: contact.clinic.url,
    contactEmail: contact.email,
    contactPhone: contact.clinic.contactPhone,
    gbpUrl: contact.clinic.gbpUrl,
    bookingUrl: contact.clinic.bookingUrl,
  });
}
