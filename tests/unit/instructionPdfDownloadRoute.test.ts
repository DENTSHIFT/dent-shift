import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  getOptionOrderById: vi.fn(),
  getArtifactByOrderId: vi.fn(),
  markArtifactDownloaded: vi.fn(),
  recordClinicAuditLog: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/db/optionOrderRepository", () => ({
  getOptionOrderById: mocks.getOptionOrderById,
}));
vi.mock("@/server/db/generatedArtifactRepository", () => ({
  getArtifactByOrderId: mocks.getArtifactByOrderId,
  markArtifactDownloaded: mocks.markArtifactDownloaded,
}));
vi.mock("@/server/db/clinicAuditLogRepository", () => ({
  recordClinicAuditLog: mocks.recordClinicAuditLog,
}));
vi.mock("@/server/db/prismaClient", () => ({ prisma: {} }));

import { GET } from "@/app/api/options/instruction-pdf/[orderId]/download/route";

function request() {
  return new NextRequest("https://dent-shift.example.com/api/options/instruction-pdf/order-1/download");
}

function params(orderId = "order-1") {
  return { params: Promise.resolve({ orderId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({ id: "contact-1", clinicId: "clinic-1" });
  mocks.getOptionOrderById.mockResolvedValue({
    id: "order-1",
    clinicId: "clinic-1",
    status: "available",
    reportId: "report-1",
    version: 1,
  });
  mocks.getArtifactByOrderId.mockResolvedValue({
    generationStatus: "generated",
    fileData: Buffer.from("%PDF-mock"),
  });
});

describe("GET /api/options/instruction-pdf/[orderId]/download", () => {
  it("未ログインは401", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = await GET(request(), params());
    expect(response.status).toBe(401);
    expect(mocks.getArtifactByOrderId).not.toHaveBeenCalled();
  });

  it("他clinicの注文は404(存在を漏らさない)", async () => {
    mocks.getOptionOrderById.mockResolvedValue({
      id: "order-1",
      clinicId: "other-clinic",
      status: "available",
    });
    const response = await GET(request(), params());
    expect(response.status).toBe(404);
  });

  it("存在しない注文は404", async () => {
    mocks.getOptionOrderById.mockResolvedValue(null);
    const response = await GET(request(), params());
    expect(response.status).toBe(404);
  });

  it("決済前(draft)の注文は409でダウンロードできない", async () => {
    mocks.getOptionOrderById.mockResolvedValue({
      id: "order-1",
      clinicId: "clinic-1",
      status: "draft",
    });
    const response = await GET(request(), params());
    expect(response.status).toBe(409);
    expect(mocks.getArtifactByOrderId).not.toHaveBeenCalled();
  });

  it("checkout_created(未決済)は409", async () => {
    mocks.getOptionOrderById.mockResolvedValue({
      id: "order-1",
      clinicId: "clinic-1",
      status: "checkout_created",
    });
    const response = await GET(request(), params());
    expect(response.status).toBe(409);
  });

  it("生成未完了(fileDataなし)は409", async () => {
    mocks.getArtifactByOrderId.mockResolvedValue({ generationStatus: "generating", fileData: null });
    const response = await GET(request(), params());
    expect(response.status).toBe(409);
  });

  it("所有者かつ生成済みなら200でPDFバイト列を返し、監査ログとdownloadedAtを記録する", async () => {
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(mocks.markArtifactDownloaded).toHaveBeenCalledWith("order-1");
    expect(mocks.recordClinicAuditLog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: "artifact_downloaded", targetId: "order-1" })
    );
  });
});
