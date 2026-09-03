import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DENT SHIFT",
  description: "歯科集患を、AIでシフトする。",
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
