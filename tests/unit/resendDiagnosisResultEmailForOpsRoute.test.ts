import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  recordAuditLog: vi.fn(),
  resendDiagnosisResultEmailForOps: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));
vi.mock("@/server/services/resendDiagnosisResultEmailForOps", () => ({
  resendDiagnosisResultEmailForOps: mocks.resendDiagnosisResultEmailForOps,
}));

import { POST } from "@/app/api/ops/diagnosis-result-emails/[id]/resend/route";

function makeRequest() {
  return new NextRequest("https://ops.example.com/api/ops/diagnosis-result-emails/diag-1/resend", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentOperator.mockResolvedValue({ id: "operator-1", email: "ops@example.com", role: "admin" });
  mocks.recordAuditLog.mockResolvedValue(undefined);
});

describe("POST /api/ops/diagnosis-result-emails/[id]/resend", () => {
  it("未ログインは401", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "diag-1" }) });
    expect(res.status).toBe(401);
    expect(mocks.resendDiagnosisResultEmailForOps).not.toHaveBeenCalled();
  });

  it("診断が見つからない場合は404", async () => {
    mocks.resendDiagnosisResultEmailForOps.mockResolvedValue("diagnosis_not_found");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "diag-1" }) });
    expect(res.status).toBe(404);
  });

  it("送信先メール未登録の場合は409", async () => {
    mocks.resendDiagnosisResultEmailForOps.mockResolvedValue("no_recipient_email");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "diag-1" }) });
    expect(res.status).toBe(409);
  });

  it("メール基盤disabledの場合は409", async () => {
    mocks.resendDiagnosisResultEmailForOps.mockResolvedValue("disabled");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "diag-1" }) });
    expect(res.status).toBe(409);
  });

  it("送信失敗の場合は502", async () => {
    mocks.resendDiagnosisResultEmailForOps.mockResolvedValue("failed");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "diag-1" }) });
    expect(res.status).toBe(502);
  });

  it("成功時は200で監査ログを記録する", async () => {
    mocks.resendDiagnosisResultEmailForOps.mockResolvedValue("sent");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "diag-1" }) });
    expect(res.status).toBe(200);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ops_resend_diagnosis_result_email", targetId: "diag-1" })
    );
  });
});
