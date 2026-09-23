import type { Metadata } from "next";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";
import { LEGAL_PAGES } from "@/domain/legal/legalPages";

const page = LEGAL_PAGES.privacy;

export const metadata: Metadata = {
  title: page.title,
  robots: page.approvedBody ? undefined : { index: false, follow: false },
};

export default function PrivacyPage() {
  return <LegalPageLayout page={page} />;
}
