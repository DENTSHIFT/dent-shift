import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { applyPrismaMigrationsToTestDatabase } from "../helpers/testDatabase";

/**
 * 2026-09-24: Instagram等の流入チャネル別に診断「開始」「完了」を比較するためのUTM値が、
 * POST /api/diagnosis経由でdiagnosis_completedイベントのpayloadへ実際に記録されることを、
 * 実DBに対して確認する結合テスト。
 */

const { DiagnosisIdempotencyLockSupersededError } = vi.hoisted(() => ({
  DiagnosisIdempotencyLockSupersededError: class DiagnosisIdempotencyLockSupersededError extends Error {},
}));

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  runFreeDiagnosis: vi.fn(),
  saveDiagnosisResult: vi.fn(),
  updateEmailStatus: vi.fn(),
  resolveConfig: vi.fn(),
  createProvider: vi.fn(),
  sendResultEmail: vi.fn(),
  anonymousDiagnosisSessionId: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/auth/anonymousDiagnosisSession", () => ({
  getOrCreateAnonymousDiagnosisSessionId: mocks.anonymousDiagnosisSessionId,
}));
vi.mock("@/server/services/runFreeDiagnosis", () => ({
  runFreeDiagnosis: mocks.runFreeDiagnosis,
  InvalidDiagnosisInputError: class InvalidDiagnosisInputError extends Error {},
}));
vi.mock("@/server/db/diagnosisRepository", () => ({
  saveDiagnosisResultIfIdempotencyLockCurrent: mocks.saveDiagnosisResult,
  DiagnosisIdempotencyLockSupersededError,
  updateDiagnosisResultEmailStatus: mocks.updateEmailStatus,
}));
vi.mock("@/server/config/aiMeasurementConfig", () => ({
  resolveAiMeasurementConfigFromProcessEnv: mocks.resolveConfig,
  AiMeasurementConfigError: class AiMeasurementConfigError extends Error {},
}));
vi.mock("@/server/composition/aiMeasurementProviderFactory", () => ({
  createAiMeasurementProviderFromConfig: mocks.createProvider,
}));
vi.mock("@/server/services/sendDiagnosisResultEmail", () => ({
  sendDiagnosisResultEmail: mocks.sendResultEmail,
}));

let testDbDir: string;
let prisma: import("@prisma/client").PrismaClient;
let POST: typeof import("@/app/api/diagnosis/route").POST;
let POST_STARTED: typeof import("@/app/api/events/diagnosis-started/route").POST;

beforeAll(async () => {
  const testTmpRoot =
    process.platform === "darwin" ? realpathSync("/tmp") : realpathSync(tmpdir());
  testDbDir = mkdtempSync(path.join(testTmpRoot, "dent-shift-diagnosis-utm-test-db-"));
  const testDbPath = path.join(testDbDir, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;
  process.env.SALESFORCE_PROVIDER = "disabled";

  applyPrismaMigrationsToTestDatabase(testDbPath);

  const clientModule = await import("@/server/db/prismaClient");
  prisma = clientModule.prisma;
  ({ POST } = await import("@/app/api/diagnosis/route"));
  ({ POST: POST_STARTED } = await import("@/app/api/events/diagnosis-started/route"));
}, 60000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (testDbDir) rmSync(testDbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.integrationEvent.deleteMany();
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue(null);
  mocks.anonymousDiagnosisSessionId.mockResolvedValue("test-anon-session-id");
  mocks.resolveConfig.mockReturnValue({ provider: "mock" });
  mocks.createProvider.mockReturnValue({});
  mocks.runFreeDiagnosis.mockResolvedValue({
    clinicName: "UTMテスト歯科",
    measuredAt: "2026-09-29T00:00:00.000Z",
    scoreBreakdown: {
      totalPoints: 42,
      domains: [
        { domain: "AIO", status: "measured" },
        { domain: "LLMO", status: "unavailable" },
      ],
    },
  });
  // 2026-09-29修正: diagnosis_completedイベントのpayloadはsaveDiagnosisResult()が返す
  // persistedUtm(実際にDBへ確定したUTM)を使うようになった。このテストは常に匿名の
  // 新規Clinic作成経路(currentContact=null)のみを扱うため、persistedUtm=input.utmで
  // 実際のrepositoryの新規Clinic時の挙動(今回の入力がそのままfirst-touchになる)を再現する。
  // 2026-09-29修正(PO指摘、3回目): 診断保存トランザクション内でSalesforce送信待ち
  // イベントも作成するようになった(saveDiagnosisResultIfIdempotencyLockCurrentの
  // 第4引数のbuilder)。このテストはsaveDiagnosisResultIfIdempotencyLockCurrent自体を
  // モックしているため、実際のトランザクションは走らないが、route.tsが渡す
  // builderコールバックを呼び出し、実DBへIntegrationEvent行を作ることで、
  // 「診断payload→IntegrationEvent.payloadJson」という実際の経路を引き続き検証する。
  mocks.saveDiagnosisResult.mockImplementation(
    async (
      input: { utm?: Record<string, string | null> },
      _result: unknown,
      _idempotency: unknown,
      buildIntegrationEvent?: (saved: {
        clinicId: string;
        diagnosisId: string;
        persistedUtm: Record<string, string | null>;
      }) => { eventType: string; clinicId?: string | null; contactId?: string | null; payload: Record<string, unknown> } | null
    ) => {
      const saved = {
        clinicId: "clinic-utm-test",
        diagnosisId: "diagnosis-utm-test",
        persistedUtm: input.utm ?? {
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
        },
      };
      const eventInput = buildIntegrationEvent?.(saved) ?? null;
      let integrationEventId: string | null = null;
      if (eventInput) {
        const event = await prisma.integrationEvent.create({
          data: {
            eventType: eventInput.eventType,
            clinicId: eventInput.clinicId ?? null,
            contactId: eventInput.contactId ?? null,
            payloadJson: JSON.stringify(eventInput.payload),
            status: "pending",
          },
        });
        integrationEventId = event.id;
      }
      return { ...saved, integrationEventId };
    }
  );
  mocks.updateEmailStatus.mockResolvedValue({ resultEmailStatus: "disabled", resultEmailSentAt: null });
  mocks.sendResultEmail.mockResolvedValue("disabled");
});

let requestSeq = 0;

function request(body: Record<string, unknown>) {
  requestSeq += 1;
  return new NextRequest("http://localhost/api/diagnosis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientRequestId: `utm-test-request-${requestSeq}`, ...body }),
  });
}

function startedRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/events/diagnosis-started", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ALL_FIVE_UTM = {
  utmSource: "instagram",
  utmMedium: "profile",
  utmCampaign: "launch",
  utmContent: "bio-link",
  utmTerm: "ai-diagnosis",
};

describe("POST /api/diagnosis: UTM値のdiagnosis_completedイベントへの記録", () => {
  it("UTM5項目を渡すと、diagnosis_completedイベントのpayloadに5項目とも含まれる", async () => {
    const response = await POST(
      request({
        clinicName: "UTMテスト歯科",
        clinicUrl: "https://utm-test.example.com",
        contactEmail: "owner@example.com",
        contactPhone: "03-1234-5678",
        ...ALL_FIVE_UTM,
      })
    );
    expect(response.status).toBe(201);

    const event = await prisma.integrationEvent.findFirstOrThrow({
      where: { eventType: "diagnosis_completed" },
    });
    const payload = JSON.parse(event.payloadJson);
    expect(payload).toEqual({
      email: "owner@example.com",
      clinic_name: "UTMテスト歯科",
      director_name: "",
      website_url: "https://utm-test.example.com",
      phone: "03-1234-5678",
      contact_id: null,
      diagnosis_id: "diagnosis-utm-test",
      diagnosis_measured_at: "2026-09-29T00:00:00.000Z",
      total_score: 42,
      aio_status: "measured",
      llmo_status: "unavailable",
      utm_source: "instagram",
      utm_medium: "profile",
      utm_campaign: "launch",
      utm_content: "bio-link",
      utm_term: "ai-diagnosis",
    });
  });

  it("UTM値を渡さない場合は5項目ともnullとして記録される(既存LP経由・直接流入)", async () => {
    const response = await POST(
      request({
        clinicName: "直接流入歯科",
        clinicUrl: "https://direct-test.example.com",
        contactEmail: "owner2@example.com",
        contactPhone: "03-1234-5678",
      })
    );
    expect(response.status).toBe(201);

    const event = await prisma.integrationEvent.findFirstOrThrow({
      where: { eventType: "diagnosis_completed" },
    });
    const payload = JSON.parse(event.payloadJson);
    expect(payload.utm_source).toBeNull();
    expect(payload.utm_medium).toBeNull();
    expect(payload.utm_campaign).toBeNull();
    expect(payload.utm_content).toBeNull();
    expect(payload.utm_term).toBeNull();
  });
});

describe("開始(diagnosis_started)と完了(diagnosis_completed)のUTM整合性", () => {
  it("同じUTM5項目を渡した場合、開始イベントと完了イベントのpayloadのUTM部分が一致する", async () => {
    const startedRes = await POST_STARTED(startedRequest(ALL_FIVE_UTM));
    expect(startedRes.status).toBe(204);

    const completedRes = await POST(
      request({
        clinicName: "整合性テスト歯科",
        clinicUrl: "https://parity-test.example.com",
        contactEmail: "owner3@example.com",
        contactPhone: "03-1234-5678",
        ...ALL_FIVE_UTM,
      })
    );
    expect(completedRes.status).toBe(201);

    const startedEvent = await prisma.integrationEvent.findFirstOrThrow({
      where: { eventType: "diagnosis_started" },
    });
    const completedEvent = await prisma.integrationEvent.findFirstOrThrow({
      where: { eventType: "diagnosis_completed" },
    });

    const expectedUtm = {
      utm_source: "instagram",
      utm_medium: "profile",
      utm_campaign: "launch",
      utm_content: "bio-link",
      utm_term: "ai-diagnosis",
    };
    expect(JSON.parse(startedEvent.payloadJson)).toEqual(expectedUtm);
    expect(JSON.parse(completedEvent.payloadJson)).toMatchObject(expectedUtm);
  });
});
