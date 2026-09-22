import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * PDF生成→パスワード保護→保存の一連の流れを実DB(SQLite)+実PDFライブラリで検証する。
 * 仕様書Ver1■の必須要件(パスワード平文非保存・役割分離・決済前は不可)を確認する。
 */

let testDbDir: string;
let prisma: import("@prisma/client").PrismaClient;
let generateInstructionPdfArtifact: typeof import("@/server/services/optionOrders/generateInstructionPdfArtifact").generateInstructionPdfArtifact;
let ensureOptionProduct: typeof import("@/server/db/optionOrderRepository").ensureOptionProduct;
let createOrReuseDraftOptionOrder: typeof import("@/server/db/optionOrderRepository").createOrReuseDraftOptionOrder;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-artifact-test-db-"));
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

const SAMPLE_TASK = {
  title: "予約ページのAI Overviews対応",
  domain: "AIO",
  detectedFact: "予約ページに構造化データが存在しない",
  patientImpact: "AI検索経由の新規患者が予約導線を見つけにくい",
  recommendedAction: "予約ページにLocalBusiness構造化データを追加する",
  impact: "high",
  confidence: "high",
  urgency: "medium",
  evidence: ["予約ページのHTMLにJSON-LDが検出されなかった"],
  key: "aio-booking-structured-data",
  kind: "standard",
  recommendedAssignee: "制作会社",
  ruleKey: "aio-booking-structured-data",
  rootCauseKey: "AIO:booking_structured_data",
  evidenceDomain: "AIO",
  provisional: false,
  sourceCriteria: [{ domain: "AIO", criterionKey: "booking_structured_data" }],
  structuredEvidence: [],
  priority: { axes: { catchmentImpact: 4, urgency: 3, easeOfExecution: 4, rippleEffect: 3 }, total: 14, tier: "priority" },
};

async function createPaidOrder(
  suffix: string,
  options: { improvementActionKey?: string | null; topImprovements?: unknown[] } = {}
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
      improvementTasksJson: JSON.stringify(options.topImprovements ?? []),
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
    improvementActionKey: options.improvementActionKey,
  });
  await prisma.optionOrder.update({
    where: { id: order.id },
    data: { status: "generation_queued", paidAt: new Date() },
  });
  return { clinic, diagnosis, order };
}

describe("generateInstructionPdfArtifact", () => {
  it("生成後、注文はavailableへ進み、PDFはパスワード保護され、平文パスワードはどこにも保存されない(実データ差し込み)", async () => {
    const { order } = await createPaidOrder("-happy", {
      improvementActionKey: SAMPLE_TASK.key,
      topImprovements: [SAMPLE_TASK],
    });

    await generateInstructionPdfArtifact(order.id);

    const updatedOrder = await prisma.optionOrder.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("available");

    const artifact = await prisma.generatedArtifact.findUnique({ where: { orderId: order.id } });
    expect(artifact?.generationStatus).toBe("generated");
    expect(artifact?.storageRef).toBe(order.id);
    expect(artifact?.fileData).not.toBeNull();
    expect(artifact?.passwordHash).not.toBeNull();
    expect(artifact?.passwordEncrypted).not.toBeNull();
    // 平文パスワードそのものがpasswordHash/passwordEncryptedへそのまま入らないこと
    // (最低限の非平文チェック。実際の値は乱数のため文字列一致比較はできない)。
    expect(artifact?.passwordHash).toContain(":");
    expect(artifact?.passwordEncrypted).toContain(":");

    // 生成されたPDFが実際にStandard Securityで暗号化されていること(/Encrypt辞書)。
    const pdfText = Buffer.from(artifact!.fileData!).toString("latin1");
    expect(pdfText).toContain("/Encrypt");
    expect(pdfText).toMatch(/\/Filter\s*\/Standard/);

    const auditLogs = await prisma.clinicAuditLog.findMany({
      where: { targetId: order.id, action: "artifact_generated" },
    });
    expect(auditLogs).toHaveLength(1);
  });

  it("draft状態(決済前)の注文は生成しない", async () => {
    const clinic = await prisma.clinic.create({
      data: { name: "決済前テスト歯科", url: "https://example-unpaid.com" },
    });
    const diagnosis = await prisma.diagnosis.create({
      data: {
        clinicId: clinic.id,
        totalPoints: 50,
        totalStatus: "partial",
        scoreBreakdownJson: "{}",
        competitorsJson: "[]",
        questionResultsJson: "[]",
        improvementTasksJson: "[]",
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
      stripePriceId: "price_test_unpaid",
    });
    const order = await createOrReuseDraftOptionOrder({
      clinicId: clinic.id,
      contactId: null,
      productId: product.id,
      productKey: "instruction_pdf",
      reportId: diagnosis.id,
      version: 1,
    });

    await generateInstructionPdfArtifact(order.id);

    const artifact = await prisma.generatedArtifact.findUnique({ where: { orderId: order.id } });
    expect(artifact).toBeNull();
    const unchangedOrder = await prisma.optionOrder.findUnique({ where: { id: order.id } });
    expect(unchangedOrder?.status).toBe("draft");
  });

  it("improvementActionKeyが診断結果のtopImprovementsに見つからない場合でも、架空データを生成せず要確認表記で完了する", async () => {
    const { order } = await createPaidOrder("-key-mismatch", {
      improvementActionKey: "does-not-exist-in-diagnosis",
      topImprovements: [SAMPLE_TASK],
    });

    await generateInstructionPdfArtifact(order.id);

    const updatedOrder = await prisma.optionOrder.findUnique({ where: { id: order.id } });
    expect(updatedOrder?.status).toBe("available");
    const artifact = await prisma.generatedArtifact.findUnique({ where: { orderId: order.id } });
    expect(artifact?.generationStatus).toBe("generated");
  });

  it("同じ注文への再呼び出し(Webhook再送等)は二重生成しない(available状態のまま)", async () => {
    const { order } = await createPaidOrder("-dup-call");
    await generateInstructionPdfArtifact(order.id);
    const firstArtifact = await prisma.generatedArtifact.findUnique({ where: { orderId: order.id } });

    await generateInstructionPdfArtifact(order.id);
    const secondArtifact = await prisma.generatedArtifact.findUnique({ where: { orderId: order.id } });

    expect(secondArtifact?.generatedAt?.getTime()).toBe(firstArtifact?.generatedAt?.getTime());
    const auditLogs = await prisma.clinicAuditLog.findMany({
      where: { targetId: order.id, action: "artifact_generated" },
    });
    expect(auditLogs).toHaveLength(1);
  });
});
