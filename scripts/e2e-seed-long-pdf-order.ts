/**
 * 手動E2E専用の一時スクリプト。実行後は使い捨て(コミット不要)。
 * 長文(2ページ以上)の指示書PDFを実ブラウザで目視確認するため、長いテキストを持つ
 * ImprovementCandidateを既存clinicの新規Diagnosisとして追加し、決済済み扱いの
 * OptionOrderを作成してPDF生成まで直接実行する(Stripe決済自体は別途検証済みのため
 * ここではスキップし、PDF描画の確認に絞る)。
 *
 * 使い方: DATABASE_URL=... ARTIFACT_PASSWORD_ENC_KEY=... npx tsx --conditions=react-server \
 *   scripts/e2e-seed-long-pdf-order.ts <clinicId>
 */
import { PrismaClient } from "@prisma/client";
import { ensureOptionProduct, createOrReuseDraftOptionOrder } from "../src/server/db/optionOrderRepository";
import { generateInstructionPdfArtifact } from "../src/server/services/optionOrders/generateInstructionPdfArtifact";
import type { ImprovementCandidate } from "../src/domain/improvement-task/types";

const LONG_SENTENCE =
  "予約ページ(https://sample-dental-e2e-2.example.com/reservation)にはLocalBusiness/MedicalOrganizationの構造化データ(JSON-LD)が一切含まれておらず、診療時間・住所・電話番号・対応診療科目のいずれもAI検索エンジンが機械的に読み取れる形では提供されていません。加えて、トップページのH1見出しは「ようこそ」のみで、歯科医院であることや対応可能な施術(一般歯科・小児歯科・矯正歯科・インプラント・ホワイトニング等)がテキストとして明示されていないため、検索エンジンおよび生成AIの双方にとって、このページが歯科医院の予約ページであることを正確に理解することが困難な状態になっています。";

const LONG_TASK: ImprovementCandidate = {
  title:
    "予約ページがAIエージェント(ChatGPT/Gemini/Google AI Overviews)から発見されず、AI経由の新規患者を取りこぼしている(構造化データ未実装・見出し不備の複合要因)",
  domain: "AIO",
  detectedFact: LONG_SENTENCE + " " + LONG_SENTENCE,
  patientImpact:
    "ChatGPTやGeminiに「近くの歯医者で今日予約できるところ」「子供を連れて行きやすい歯医者」のように尋ねた患者に対し、医院の情報が提示されない、または不正確な診療時間・休診日が提示されるリスクがあります。" +
    LONG_SENTENCE,
  recommendedAction:
    "予約ページのheadタグ内にLocalBusiness構造化データ(JSON-LD形式)を追加し、name/address/openingHours/telephone/medicalSpecialty/priceRangeを正確に記載してください。あわせて、ページ本文中に対応施術内容(一般歯科・小児歯科・矯正歯科・口腔外科・ホワイトニング等)を箇条書きで明示し、H1見出しを「〇〇歯科医院の予約 - 一般歯科・小児歯科・矯正歯科に対応」のように具体化してください。" +
    LONG_SENTENCE,
  impact: "high",
  confidence: "high",
  urgency: "high",
  evidence: [
    "予約ページのHTML内にJSON-LD形式の構造化データが検出されませんでした(2026-09-22 診断時点)。",
    "H1見出しに施術内容の記載がなく、対応診療科目がテキストとして抽出できませんでした。",
    "meta descriptionタグが未設定のため、検索結果・AI要約の双方で医院の説明文が生成されていません。",
    "予約ページ内のtel:リンクが正規化された電話番号形式(+81)になっておらず、AIが電話番号として認識できない可能性があります。",
  ],
  key: "aio-booking-structured-data-long-e2e",
  kind: "standard",
  recommendedAssignee: "制作会社",
  ruleKey: "aio-booking-structured-data-long-e2e",
  rootCauseKey: "AIO:booking_structured_data_long_e2e",
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
  const clinicId = process.argv[2];
  if (!clinicId) {
    console.error("usage: tsx scripts/e2e-seed-long-pdf-order.ts <clinicId>");
    process.exit(1);
  }
  const prisma = new PrismaClient();

  const diagnosis = await prisma.diagnosis.create({
    data: {
      clinicId,
      totalPoints: 48,
      totalStatus: "partial",
      scoreBreakdownJson: "{}",
      competitorsJson: "[]",
      questionResultsJson: "[]",
      improvementTasksJson: JSON.stringify([LONG_TASK]),
      dataDisclaimer: "",
    },
  });
  console.log("diagnosisId:", diagnosis.id);

  const product = await ensureOptionProduct({
    definition: {
      key: "instruction_pdf",
      name: "制作会社向け修正指示書",
      description: "テスト用説明",
      deliveryType: "pdf",
      priceJpy: 3300,
      displayLabel: "3,300円（税込）/ 1件",
    },
    stripePriceId: "price_test_long_e2e",
  });

  const order = await createOrReuseDraftOptionOrder({
    clinicId,
    contactId: null,
    productId: product.id,
    productKey: "instruction_pdf",
    reportId: diagnosis.id,
    version: 1,
    improvementActionKey: LONG_TASK.key,
  });
  await prisma.optionOrder.update({
    where: { id: order.id },
    data: { status: "generation_queued", paidAt: new Date() },
  });
  console.log("orderId:", order.id);

  await generateInstructionPdfArtifact(order.id);
  const updated = await prisma.optionOrder.findUniqueOrThrow({ where: { id: order.id } });
  console.log("order status:", updated.status);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
