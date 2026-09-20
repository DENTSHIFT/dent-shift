/**
 * DENT SHIFT専用電話番号(050-1785-5264、2026-09-20発行)の共通表示コンポーネント。
 * ユーザー起点の問い合わせのみを想定し、DENT SHIFT側から営業電話は一切行わない
 * (最重要原則: 営業マン0人・営業電話なし)。未設定環境ではCTA自体を描画しない。
 */
export function SupportPhoneFooter() {
  const phoneNumber = process.env.NEXT_PUBLIC_SUPPORT_PHONE_NUMBER;
  if (!phoneNumber) return null;

  return (
    <p
      style={{
        margin: "24px 0 0",
        textAlign: "center",
        fontSize: 12,
        color: "#6B7280",
        lineHeight: 1.7,
      }}
    >
      お電話でのお問い合わせ:{" "}
      <a href={`tel:${phoneNumber}`} style={{ color: "#2563EB", fontWeight: 700, textDecoration: "none" }}>
        {phoneNumber}
      </a>
      (こちらからの営業電話は一切行いません)
    </p>
  );
}
