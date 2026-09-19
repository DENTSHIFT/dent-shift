import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  runFreeDiagnosis: vi.fn(),
  saveDiagnosisResult: vi.fn(),
  updateEmailStatus: vi.fn(),
  resolveConfig: vi.fn(),
  createProvider: vi.fn(),
  findDuplicate: vi.fn(),
  sendResultEmail: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentContact: mocks.currentContact,
}));

vi.mock("@/server/services/runFreeDiagnosis", () => ({
  runFreeDiagnosis: mocks.runFreeDiagnosis,
  InvalidDiagnosisInputError: class InvalidDiagnosisInputError extends Error {},
}));

vi.mock("@/server/db/diagnosisRepository", () => ({
  saveDiagnosisResult: mocks.saveDiagnosisResult,
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

import { POST } from "@/app/api/diagnosis/route";

const diagnosisResult = { clinicName: "テスト歯科医院" };

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/diagnosis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
      diagnosisResult
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
      diagnosisResult
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
      diagnosisResult
    );
  });
});
