import { isInsecureHttpUrl } from "./clinicProfile";

export interface HttpsAdvisory {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

// 実際のHTTPS対応状況は確認していないため、「対応していない可能性」として案内する。
// 表示可否は現在のWebサイトURLだけで決める(保存しない。https:// に変更すれば自動的に表示されなくなる)。
export function buildHttpsAdvisory(clinicUrl: string | null | undefined): HttpsAdvisory | null {
  if (!clinicUrl || !isInsecureHttpUrl(clinicUrl)) return null;
  return {
    title: "WebサイトをHTTPSに対応しましょう",
    description:
      "登録されているWebサイトは、安全な通信を示すHTTPSに対応していない可能性があります。HTTPSに対応すると、患者さまが安心してサイトを閲覧でき、ブラウザの警告表示や情報漏えいのリスクを減らせます。サイトの管理会社または制作会社へ、SSL証明書の設定についてご相談ください。",
    actionLabel: "WebサイトURLを確認する",
    actionHref: "/dashboard/settings",
  };
}
