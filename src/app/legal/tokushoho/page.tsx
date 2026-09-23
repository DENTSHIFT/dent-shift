import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";
import { LEGAL_PAGES } from "@/domain/legal/legalPages";

const page = LEGAL_PAGES.tokushoho;

export const metadata: Metadata = {
  title: page.title,
  robots: page.approvedBody ? undefined : { index: false, follow: false },
};

export default function TokushohoPage() {
  return <LegalPageLayout page={page} />;
}
