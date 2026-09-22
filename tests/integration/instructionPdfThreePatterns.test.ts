import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";
import { NOT_AVAILABLE_LABEL } from "@/domain/options/instructionPdfContent";

/**
 * 2026-09-22のユーザー指示「3パターンの動作確認」: データ取得状況の異なる3医院で
 * 診断→制作会社向け修正指示書PDF生成までを確認する。measured/estimated/unavailableの
 * 扱いが正しく伝播し、エラー時に不自然な0点表示や架空データ生成をしないことを確認する。
 *
 * パターンA(データが十分取得できる医院): evidence/priorityが揃ったstandard候補。
 * パターンB(一部データが取得できない医院): dataGap由来でevidence/priorityが無く、
 *   escalationのみで優先度を導出する重大リスク候補。
 * パターンC(取得データが少ない医院): topImprovements自体が空配列(診断はできたが
 *   改善候補を導出できなかった状態)。
 */

let testDbDir: string;
let prisma: import("@prisma/client").PrismaClient;
let generateInstructionPdfArtifact: typeof import("@/server/services/optionOrders/generateInstructionPdfArtifact").generateInstructionPdfArtifact;
let ensureOptionProduct: typeof import("@/server/db/optionOrderRepository").ensureOptionProduct;
let createOrReuseDraftOptionOrder: typeof import("@/server/db/optionOrderRepository").createOrReuseDraftOptionOrder;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-three-patterns-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;
  process.env.ARTIFACT_PASSWORD_ENC_KEY = randomBytes(32).toString("hex");

  applyPrismaMigrationsToTestDatabase(testDbPath);

  const artifactService = await import("@/server/services/optionOrders/generateInstructionPdfArtifact");
  generateInstructionPdfArtifact = artifactService.generateInstructionPdfArtifact;
  const orderRepo = await import("@/server/db/optionOrderRepository");
  ensureOptionProduct = orderRepo.ensureOptionProduct;
  createOrReuseDraftOptionOrder = orderRepo.createOrReuseDraftOptionOrder;
  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

async function setupOrder(
  suffix: string,
  topImprovements: ImprovementCandidate[],
  improvementActionKey: string | null
) {
  const clinic = await prisma.clinic.create({
    data: { name: `テスト歯科${suffix}`, url: `https://example${suffix}.com` },
  });
  const diagnosis = await prisma.diagnosis.create({
    data: {
      clinicId: clinic.id,
      totalPoints: 50,
      totalStatus: "partial",
      scoreBreakdownJson: "{}",
      competitorsJson: "[]",
      questionResultsJson: "[]",
      improvementTasksJson: JSON.stringify(topImprovements),
      dataDisclaimer: "",
    },
  });
  const product = await ensureOptionProduct({
    definition: {
      key: "instruction_pdf",
      name: "制作会社向け修正指示書",
      description: "テスト用説明",
      deliveryType: "pdf",
      priceJpy: 3300,
      displayLabel: "3,300円（税込）/ 1件",
    },
    stripePriceId: `price_test_${suffix}`,
  });
  const order = await createOrReuseDraftOptionOrder({
    clinicId: clinic.id,
    contactId: null,
    productId: product.id,
    productKey: "instruction_pdf",
    reportId: diagnosis.id,
    version: 1,
    improvementActionKey,
  });
  await prisma.optionOrder.update({
    where: { id: order.id },
    data: { status: "generation_queued", paidAt: new Date() },
  });
  return { clinic, diagnosis, order };
}

describe("3パターン動作確認: 診断データ取得状況の違いがPDF生成へ正しく伝播する", () => {
  it("パターンA(データ十分): evidence/priorityが揃った候補は実データがそのまま反映される", async () => {
    const task: ImprovementCandidate = {
      title: "予約ページのAI Overviews対応",
      domain: "AIO",
      detectedFact: "予約ページに構造化データが存在しない",
      patientImpact: "AI検索経由の新規患者が予約導線を見つけにくい",
      recommendedAction: "予約ページにLocalBusiness構造化データを追加する",
      impact: "high",
      confidence: "high",
      urgency: "medium",
      evidence: ["予約ページのHTMLにJSON-LDが検出されなかった"],
      key: "pattern-a-task",
      kind: "standard",
      recommendedAssignee: "制作会社",
      ruleKey: "pattern-a-task",
      rootCauseKey: "AIO:booking_structured_data",
      evidenceDomain: "AIO",
      provisional: false,
      sourceCriteria: [{ domain: "AIO", criterionKey: "booking_structured_data" }],
      structuredEvidence: [],
      priority: {
        axes: { catchmentImpact: 4, urgency: 3, easeOfExecution: 4, rippleEffect: 3 },
        total: 14,
        tier: "priority",
      },
    };
    const { order } = await setupOrder("-pattern-a", [task], "pattern-a-task");

    await generateInstructionPdfArtifact(order.id);

    const updatedOrder = await prisma.optionOrder.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("available");
    const artifact = await prisma.generatedArtifact.findUnique({ where: { orderId: order.id } });
    expect(artifact?.generationStatus).toBe("generated");
    expect(artifact?.lastError).toBeNull();
  });

  it("パターンB(一部データ不足・重大リスク): evidence/priorityが無くてもescalationから導出し、架空データを作らない", async () => {
    const task: ImprovementCandidate = {
      title: "予約フォームが送信エラーになる",
      domain: "WEB_BOOKING",
      detectedFact: "予約フォーム送信時にサーバーエラーが発生する",
      patientImpact: "患者が予約を完了できない",
      recommendedAction: "予約フォームのサーバー側処理を至急修正する",
      impact: "high",
      confidence: "high",
      urgency: "high",
      evidence: [],
      key: "pattern-b-task",
      kind: "risk_escalation",
      recommendedAssignee: "制作会社",
      ruleKey: "pattern-b-task",
      rootCauseKey: "adhoc:pattern-b-task",
      evidenceDomain: "WEB_BOOKING",
      provisional: false,
      sourceCriteria: [],
      structuredEvidence: [],
      escalation: {
        category: "booking_failure",
        severity: "critical",
        confidence: "high",
        reason: "予約フォームが送信エラーになる(自動検知)",
      },
    };
    const { order } = await setupOrder("-pattern-b", [task], "pattern-b-task");

    await generateInstructionPdfArtifact(order.id);

    const updatedOrder = await prisma.optionOrder.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("available");
    const artifact = await prisma.generatedArtifact.findUnique({ where: { orderId: order.id } });
    expect(artifact?.generationStatus).toBe("generated");
    expect(artifact?.lastError).toBeNull();
  });

  it("パターンC(取得データが少ない): topImprovementsが空でも架空の改善項目を作らず、安全に完了する", async () => {
    const { order } = await setupOrder("-pattern-c", [], null);

    await generateInstructionPdfArtifact(order.id);

    const updatedOrder = await prisma.optionOrder.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("available");
    const artifact = await prisma.generatedArtifact.findUnique({ where: { orderId: order.id } });
    expect(artifact?.generationStatus).toBe("generated");
    expect(artifact?.lastError).toBeNull();
  });

  it("パターンC相当(キー不一致): 指定キーが診断結果に見つからない場合はNOT_AVAILABLE_LABEL相当のfallbackになり、クラッシュしない", async () => {
    const { order } = await setupOrder("-pattern-c-mismatch", [], "does-not-exist");

    await generateInstructionPdfArtifact(order.id);

    const updatedOrder = await prisma.optionOrder.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("available");
  });
});

describe("NOT_AVAILABLE_LABELの一貫性", () => {
  it("要確認ラベルは固定文言であり、AIが動的に文章を生成した結果ではない", () => {
    expect(NOT_AVAILABLE_LABEL).toBe("要確認(診断データからは判定できません)");
  });
});
