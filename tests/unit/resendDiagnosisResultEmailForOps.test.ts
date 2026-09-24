import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDiagnosisById: vi.fn(),
  updateDiagnosisResultEmailStatus: vi.fn(),
  findUnique: vi.fn(),
  sendDiagnosisResultEmail: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: { clinic: { findUnique: mocks.findUnique } },
}));
vi.mock("@/server/db/diagnosisRepository", () => ({
  getDiagnosisById: mocks.getDiagnosisById,
  updateDiagnosisResultEmailStatus: mocks.updateDiagnosisResultEmailStatus,
}));
vi.mock("@/server/services/sendDiagnosisResultEmail", () => ({
  sendDiagnosisResultEmail: mocks.sendDiagnosisResultEmail,
}));

import { resendDiagnosisResultEmailForOps } from "@/server/services/resendDiagnosisResultEmailForOps";

const SAMPLE_DIAGNOSIS = {
  clinicId: "clinic-1",
  clinicName: "テスト歯科",
  isSample: false,
  topImprovements: [],
  scoreBreakdown: { totalPoints: 50, totalStatus: "partial", maxPoints: 100 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDiagnosisById.mockResolvedValue(SAMPLE_DIAGNOSIS);
  mocks.findUnique.mockResolvedValue({ contactEmail: "owner@example.com" });
  mocks.updateDiagnosisResultEmailStatus.mockResolvedValue(undefined);
});

describe("resendDiagnosisResultEmailForOps", () => {
  it("診断が存在しない場合はdiagnosis_not_foundを返す", async () => {
    mocks.getDiagnosisById.mockResolvedValue(null);
    const result = await resendDiagnosisResultEmailForOps("missing");
    expect(result).toBe("diagnosis_not_found");
    expect(mocks.sendDiagnosisResultEmail).not.toHaveBeenCalled();
  });

  it("送信先メールが無い場合はno_recipient_emailを返す", async () => {
    mocks.findUnique.mockResolvedValue({ contactEmail: null });
    const result = await resendDiagnosisResultEmailForOps("diag-1");
    expect(result).toBe("no_recipient_email");
    expect(mocks.sendDiagnosisResultEmail).not.toHaveBeenCalled();
  });

  it("正常系: sendDiagnosisResultEmailへ正しい送信先・件名素材を渡し、成功時はresultEmailStatusをsentへ更新する", async () => {
    mocks.sendDiagnosisResultEmail.mockResolvedValue("sent");
    const result = await resendDiagnosisResultEmailForOps("diag-1");
    expect(result).toBe("sent");
    expect(mocks.sendDiagnosisResultEmail).toHaveBeenCalledWith({
      to: "owner@example.com",
      diagnosisId: "diag-1",
      result: {
        clinicName: "テスト歯科",
        isSample: false,
        topImprovements: [],
        scoreBreakdown: { totalPoints: 50, totalStatus: "partial", maxPoints: 100 },
      },
    });
    expect(mocks.updateDiagnosisResultEmailStatus).toHaveBeenCalledWith("diag-1", "sent");
  });

  it("メール基盤disabledの場合はdisabledを返し、resultEmailStatusをdisabledにする", async () => {
    mocks.sendDiagnosisResultEmail.mockResolvedValue("disabled");
    const result = await resendDiagnosisResultEmailForOps("diag-1");
    expect(result).toBe("disabled");
    expect(mocks.updateDiagnosisResultEmailStatus).toHaveBeenCalledWith("diag-1", "disabled");
  });

  it("送信が例外を投げた場合はfailedを返し、resultEmailStatusをfailedのまま保つ", async () => {
    mocks.sendDiagnosisResultEmail.mockRejectedValue(new Error("resend down"));
    const result = await resendDiagnosisResultEmailForOps("diag-1");
    expect(result).toBe("failed");
    expect(mocks.updateDiagnosisResultEmailStatus).toHaveBeenCalledWith("diag-1", "failed");
  });
});
