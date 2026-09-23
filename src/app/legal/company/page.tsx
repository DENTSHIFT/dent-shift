import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";
import { LEGAL_PAGES } from "@/domain/legal/legalPages";

const page = LEGAL_PAGES.company;

// 承認済み本文が無い間は検索エンジンにインデックスさせない(2026-09-23公開前QA対応)。
export const metadata: Metadata = {
  title: page.title,
  robots: page.approvedBody ? undefined : { index: false, follow: false },
};

export default function CompanyPage() {
  return <LegalPageLayout page={page} />;
}
