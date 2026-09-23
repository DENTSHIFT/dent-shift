import type { Metadata } from "next";

const SITE_URL = "https://dentshift.jp";
const TITLE = "DENT SHIFT｜歯科医院向けAI集患支援";
const DESCRIPTION =
  "DENT SHIFTは、歯科医院の集患状況をAIとデータで可視化し、改善につなげる歯科医院向けAI集患支援プラットフォームです。";
const OG_IMAGE = `${SITE_URL}/og/dent-shift-ogp.png`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "DENT SHIFT",
    locale: "ja_JP",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "DENT SHIFT" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f8fa" }}>
        {children}
      </body>
    </html>
  );
}
