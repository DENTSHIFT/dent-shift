/**
 * 手動確認用スクリプト(コミット対象外の一時ツールではなく、繰り返し使える診断ツールとして
 * scripts/配下に置く)。実データ相当の長文を含むImprovementCandidateからPDFを生成し、
 * 日本語崩れ・ページ切れ・長文レイアウトを目視確認する。
 *
 * 使い方: npx tsx --conditions=react-server scripts/instruction-pdf-smoke.ts
 */
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { buildInstructionPdfDocument } from "../src/server/pdf/instructionPdfDocument";
import { protectPdfWithPassword } from "../src/server/pdf/pdfPasswordProtection";
import { mapImprovementCandidateToInstructionPdfItem } from "../src/domain/options/instructionPdfContentMapper";
import type { ImprovementCandidate } from "../src/domain/improvement-task/types";

const LONG_TASK: ImprovementCandidate = {
  title: "予約ページがAIエージェント(ChatGPT/Gemini)から発見されず、AI経由の新規患者を取りこぼしている",
  domain: "AIO",
  detectedFact:
    "予約ページ(https://example-dental-clinic.jp/reservation)にLocalBusiness/MedicalOrganizationの構造化データ(JSON-LD)が存在せず、AI検索エンジンが診療時間・住所・予約手段を正しく認識できていません。また、ページ内のH1見出しが「ご予約」のみで、対応可能な施術内容(一般歯科/小児歯科/矯正歯科等)がテキストとして明示されていないため、AIが施術内容とページを関連付けられていません。",
  patientImpact:
    "ChatGPTやGeminiに「近くの歯医者で今日予約できるところ」と尋ねた患者に対し、医院の情報が提示されない、または不正確な診療時間が提示されるリスクがあります。特に平日夜間や休日診療を行っている医院にとっては、AI経由の新規患者獲得機会の損失につながります。",
  recommendedAction:
    "予約ページのheadタグ内にLocalBusiness構造化データ(JSON-LD形式)を追加し、name/address/openingHours/telephone/medicalSpecialtyを正確に記載する。あわせて、ページ本文中に対応施術内容(一般歯科・小児歯科・矯正歯科・口腔外科等)を箇条書きで明示し、H1見出しを「〇〇歯科医院の予約 - 一般歯科・小児歯科・矯正歯科に対応」のように具体化する。",
  impact: "high",
  confidence: "high",
  urgency: "high",
  evidence: [
    "予約ページのHTML内にJSON-LD形式の構造化データが検出されませんでした(2026-09-20 診断時点)",
    "H1見出しに施術内容の記載がなく、対応診療科目がテキストとして抽出できませんでした",
  ],
  key: "aio-booking-structured-data",
  kind: "standard",
  recommendedAssignee: "制作会社",
  ruleKey: "aio-booking-structured-data",
  rootCauseKey: "AIO:booking_structured_data",
  evidenceDomain: "AIO",
  provisional: false,
  sourceCriteria: [{ domain: "AIO", criterionKey: "booking_structured_data" }],
  structuredEvidence: [],
  priority: {
    axes: { catchmentImpact: 5, urgency: 4, easeOfExecution: 3, rippleEffect: 4 },
    total: 16,
    tier: "top",
  },
};

async function main() {
  const item = mapImprovementCandidateToInstructionPdfItem(LONG_TASK);
  const pdfBytes = await buildInstructionPdfDocument({
    clinicName: "サンプル歯科医院(動作確認用)",
    clinicUrl: "https://example-dental-clinic.jp",
    reportId: "smoke-test-report-id",
    version: 1,
    generatedAt: new Date(),
    item,
  });

  await writeFile("/tmp/instruction-pdf-smoke-plain.pdf", pdfBytes);
  console.log(`平文PDF: /tmp/instruction-pdf-smoke-plain.pdf (${pdfBytes.byteLength} bytes)`);

  const password = randomBytes(4).toString("hex");
  const protectedPdf = await protectPdfWithPassword(pdfBytes, password);
  await writeFile("/tmp/instruction-pdf-smoke-protected.pdf", protectedPdf);
  console.log(
    `パスワード保護PDF: /tmp/instruction-pdf-smoke-protected.pdf (${protectedPdf.byteLength} bytes) / password=${password}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
