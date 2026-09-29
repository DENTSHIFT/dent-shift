import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
  findDuplicate: vi.fn(),
  sendResultEmail: vi.fn(),
  acquireIdempotencyLock: vi.fn(),
  markIdempotencyFailed: vi.fn(),
  reserveDiagnosisSlot: vi.fn(),
  releaseDiagnosisSlot: vi.fn(),
  anonymousDiagnosisSessionId: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentContact: mocks.currentContact,
}));

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

vi.mock("@/server/db/clinicDuplicateRepository", () => ({
  findClinicDuplicateCandidate: mocks.findDuplicate,
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

vi.mock("@/server/db/diagnosisIdempotencyRepository", () => ({
  acquireDiagnosisIdempotencyLock: mocks.acquireIdempotencyLock,
  markDiagnosisIdempotencyLockFailed: mocks.markIdempotencyFailed,
}));

vi.mock("@/server/db/diagnosisRateLimitRepository", () => ({
  reserveDiagnosisSlot: mocks.reserveDiagnosisSlot,
  releaseDiagnosisSlot: mocks.releaseDiagnosisSlot,
}));

import { POST } from "@/app/api/diagnosis/route";

const diagnosisResult = {
  clinicName: "テスト歯科医院",
  measuredAt: "2026-09-29T00:00:00.000Z",
  scoreBreakdown: {
    totalPoints: 42,
    domains: [
      { domain: "AIO", status: "measured" },
      { domain: "LLMO", status: "unavailable" },
    ],
  },
};

let requestSeq = 0;

function request(body: Record<string, unknown>) {
  requestSeq += 1;
  return new NextRequest("http://localhost/api/diagnosis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientRequestId: `test-request-id-${requestSeq}`, ...body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConfig.mockReturnValue({ provider: "mock" });
  mocks.createProvider.mockReturnValue({});
  mocks.runFreeDiagnosis.mockResolvedValue(diagnosisResult);
  mocks.saveDiagnosisResult.mockResolvedValue({
    clinicId: "saved-clinic",
    diagnosisId: "saved-diagnosis",
  });
  mocks.updateEmailStatus.mockResolvedValue({
    resultEmailStatus: "disabled",
    resultEmailSentAt: null,
  });
  mocks.findDuplicate.mockResolvedValue(null);
  mocks.sendResultEmail.mockResolvedValue("disabled");
  mocks.acquireIdempotencyLock.mockResolvedValue({ kind: "new", executionId: "test-execution-id" });
  mocks.anonymousDiagnosisSessionId.mockResolvedValue("test-anon-session-id");
  mocks.markIdempotencyFailed.mockResolvedValue(undefined);
  mocks.reserveDiagnosisSlot.mockResolvedValue({ allowed: true, executionId: "exec-1" });
  mocks.releaseDiagnosisSlot.mockResolvedValue(undefined);
});

describe("POST /api/diagnosis: 再診断の医院スコープ", () => {
  it("ログイン中はセッションのclinicIdだけを保存先に使い、bodyのclinicIdを信用しない", async () => {
    mocks.currentContact.mockResolvedValue({
      id: "contact-1",
      clinicId: "session-clinic",
      email: "registered@example.com",
      clinic: {
        id: "session-clinic",
        name: "登録済み歯科医院",
        url: "https://registered.example.com",
        contactPhone: "03-1234-5678",
        gbpUrl: "https://g.page/registered",
        bookingUrl: null,
      },
    });

    const response = await POST(
      request({
        clinicName: "テスト歯科医院",
        clinicUrl: "https://example.com",
        contactEmail: "owner@example.com",
        contactPhone: "090-1111-2222",
        clinicId: "other-clinic-from-client",
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.runFreeDiagnosis).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicName: "登録済み歯科医院",
        clinicUrl: "https://registered.example.com",
        contactEmail: "registered@example.com",
        contactPhone: "03-1234-5678",
        gbpUrl: "https://g.page/registered",
      }),
      expect.any(Object)
    );
    expect(mocks.saveDiagnosisResult).toHaveBeenCalledWith(
      expect.objectContaining({
        existingClinicId: "session-clinic",
        clinicUrl: "https://registered.example.com",
        contactEmail: "registered@example.com",
        contactPhone: "03-1234-5678",
      }),
      diagnosisResult,
      expect.objectContaining({ clientRequestId: expect.any(String), executionId: expect.any(String) }),
      expect.any(Function)
    );
    expect(mocks.saveDiagnosisResult.mock.calls[0]![0]).not.toHaveProperty("clinicId");
    expect(mocks.findDuplicate).not.toHaveBeenCalled();
    expect(mocks.sendResultEmail).toHaveBeenCalledWith({
      to: "registered@example.com",
      diagnosisId: "saved-diagnosis",
      result: diagnosisResult,
    });
    expect(mocks.updateEmailStatus).toHaveBeenCalledWith("saved-diagnosis", "disabled");
  });

  it("結果メール送信が失敗しても、保存済み診断は成功として返す", async () => {
    mocks.currentContact.mockResolvedValue(null);
    mocks.sendResultEmail.mockRejectedValue(new Error("provider failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      request({
        clinicName: "メール障害確認歯科",
        clinicUrl: "https://mail-failure.example.com",
        contactEmail: "owner@example.com",
        contactPhone: "03-1234-5678",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      diagnosisId: "saved-diagnosis",
      status: "completed",
      resultEmailStatus: "failed",
    });
    expect(mocks.updateEmailStatus).toHaveBeenCalledWith("saved-diagnosis", "failed");
    expect(consoleError).toHaveBeenCalledWith(
      "[POST /api/diagnosis] result email delivery failed:",
      "Error"
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("provider failed");
    consoleError.mockRestore();
  });

  it("未ログインではexistingClinicIdを設定せず、従来どおり匿名診断として保存する", async () => {
    mocks.currentContact.mockResolvedValue(null);

    const response = await POST(
      request({
        clinicName: "匿名診断歯科医院",
        clinicUrl: "https://anonymous.example.com",
        contactEmail: "anonymous@example.com",
        contactPhone: "03-1234-5678",
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.saveDiagnosisResult).toHaveBeenCalledWith(
      expect.objectContaining({ existingClinicId: undefined }),
      diagnosisResult,
      expect.objectContaining({ clientRequestId: expect.any(String), executionId: expect.any(String) }),
      expect.any(Function)
    );
  });

  it("重複候補がある匿名診断はAI計測前に409で案内し、医院IDを公開しない", async () => {
    mocks.currentContact.mockResolvedValue(null);
    mocks.findDuplicate.mockResolvedValue({
      clinicId: "secret-existing-clinic",
      matchType: "exact_url",
    });

    const response = await POST(
      request({
        clinicName: "重複候補歯科",
        clinicUrl: "https://duplicate.example.com",
        contactEmail: "owner@example.com",
        contactPhone: "03-1234-5678",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("clinic_duplicate_candidate");
    expect(body.matchType).toBe("exact_url");
    expect(JSON.stringify(body)).not.toContain("secret-existing-clinic");
    expect(mocks.resolveConfig).not.toHaveBeenCalled();
    expect(mocks.runFreeDiagnosis).not.toHaveBeenCalled();
    expect(mocks.saveDiagnosisResult).not.toHaveBeenCalled();
  });

  it("利用者が重複候補を確認済みなら自動統合せず、新しい診断として続行する", async () => {
    mocks.currentContact.mockResolvedValue(null);

    const response = await POST(
      request({
        clinicName: "別データ歯科",
        clinicUrl: "https://duplicate.example.com",
        contactEmail: "owner@example.com",
        contactPhone: "03-1234-5678",
        allowDuplicateClinic: true,
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.findDuplicate).not.toHaveBeenCalled();
    expect(mocks.saveDiagnosisResult).toHaveBeenCalledWith(
      expect.objectContaining({ existingClinicId: undefined }),
      diagnosisResult,
      expect.objectContaining({ clientRequestId: expect.any(String), executionId: expect.any(String) }),
      expect.any(Function)
    );
  });

  it("保存トランザクション内でexecutionIdの実行権を確保できなかった場合(TTL経過で別の実行が既に取って代わった)は、診断レコードを保存せず409を返す", async () => {
    mocks.currentContact.mockResolvedValue(null);
    mocks.saveDiagnosisResult.mockRejectedValue(
      new DiagnosisIdempotencyLockSupersededError("superseded")
    );

    const response = await POST(
      request({
        clinicName: "取って代わられた歯科",
        clinicUrl: "https://superseded.example.com",
        contactEmail: "owner@example.com",
        contactPhone: "03-1234-5678",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("execution_superseded");
  });
});

/**
 * 2026-09-27追加(PO承認): canonical AI計測providerのfail-closed回帰テスト。
 * 設定不備・mock指定のいずれでも、診断リクエスト全体を500で失敗させず、
 * canonical計測だけを無効(aiMeasurementProvider=undefined)にして診断を続行する
 * (2026-09-08時点は設定不備を500にしていたが、今回可用性よりデータの正確性を優先する
 * よう変更した)。
 */
describe("POST /api/diagnosis: canonical AI計測providerのfail-closed", () => {
  function anonymousRequest() {
    mocks.currentContact.mockResolvedValue(null);
    return request({
      clinicName: "fail-closed検証歯科",
      clinicUrl: "https://failclosed.example.com",
      contactEmail: "owner@example.com",
      contactPhone: "03-1234-5678",
    });
  }

  it("AI_MEASUREMENT_PROVIDER未設定(設定エラー)でも診断は成功し、canonicalは無効(undefined)で呼ばれる", async () => {
    class TestConfigError extends Error {}
    mocks.resolveConfig.mockImplementation(() => {
      throw new TestConfigError("AI_MEASUREMENT_PROVIDER is not set.");
    });
    // vi.mockで再定義したAiMeasurementConfigErrorをinstanceof判定に使うため、
    // route.ts側がimportするクラスと同一である必要がある。ここではモジュールモックの
    // AiMeasurementConfigErrorをそのまま使う。
    const { AiMeasurementConfigError } = await import("@/server/config/aiMeasurementConfig");
    mocks.resolveConfig.mockImplementation(() => {
      throw new AiMeasurementConfigError("AI_MEASUREMENT_PROVIDER is not set.");
    });

    const response = await POST(anonymousRequest());

    expect(response.status).toBe(201);
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.runFreeDiagnosis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ aiMeasurementProvider: undefined })
    );
  });

  it("未知のprovider値(設定エラー)でも診断は成功し、canonicalは無効になる", async () => {
    const { AiMeasurementConfigError } = await import("@/server/config/aiMeasurementConfig");
    mocks.resolveConfig.mockImplementation(() => {
      throw new AiMeasurementConfigError("AI_MEASUREMENT_PROVIDER has an invalid value.");
    });

    const response = await POST(anonymousRequest());

    expect(response.status).toBe(201);
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.runFreeDiagnosis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ aiMeasurementProvider: undefined })
    );
  });

  it("AI_MEASUREMENT_PROVIDER='mock'は警告ログを出しつつ診断を続行する(公開APIでmockをcanonicalとして使わない)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.resolveConfig.mockReturnValue({ provider: "mock" });
    mocks.createProvider.mockReturnValue(undefined); // 実装(factory)どおりmock指定はundefinedを返す

    const response = await POST(anonymousRequest());

    expect(response.status).toBe(201);
    expect(mocks.createProvider).toHaveBeenCalledWith({ provider: "mock" });
    expect(mocks.runFreeDiagnosis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ aiMeasurementProvider: undefined })
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("mock"));
    warnSpy.mockRestore();
  });

  it("OpenAI設定済みの場合はcanonical providerがそのまま渡される(fail-closedの対象外)", async () => {
    const fakeProvider = { name: "fake-openai-measurement-provider" };
    mocks.resolveConfig.mockReturnValue({ provider: "openai", apiKey: "sk-test", model: "test-model" });
    mocks.createProvider.mockReturnValue(fakeProvider);

    const response = await POST(anonymousRequest());

    expect(response.status).toBe(201);
    expect(mocks.runFreeDiagnosis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ aiMeasurementProvider: fakeProvider })
    );
  });
});
