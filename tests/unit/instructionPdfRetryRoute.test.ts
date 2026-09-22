import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  getOptionOrderById: vi.fn(),
  generateInstructionPdfArtifact: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/db/optionOrderRepository", () => ({
  getOptionOrderById: mocks.getOptionOrderById,
}));
vi.mock("@/server/services/optionOrders/generateInstructionPdfArtifact", () => ({
  generateInstructionPdfArtifact: mocks.generateInstructionPdfArtifact,
}));

import { POST } from "@/app/api/options/instruction-pdf/[orderId]/retry/route";

function request() {
  return new NextRequest("https://dent-shift.example.com/api/options/instruction-pdf/order-1/retry", {
    method: "POST",
  });
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
    status: "generation_failed",
  });
  mocks.generateInstructionPdfArtifact.mockResolvedValue(undefined);
});

describe("POST /api/options/instruction-pdf/[orderId]/retry", () => {
  it("未ログインは401", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = await POST(request(), params());
    expect(response.status).toBe(401);
    expect(mocks.generateInstructionPdfArtifact).not.toHaveBeenCalled();
  });

  it("他clinicの注文は404", async () => {
    mocks.getOptionOrderById.mockResolvedValue({ id: "order-1", clinicId: "other-clinic", status: "generation_failed" });
    const response = await POST(request(), params());
    expect(response.status).toBe(404);
  });

  it("generation_failed以外の状態からは409", async () => {
    mocks.getOptionOrderById.mockResolvedValue({ id: "order-1", clinicId: "clinic-1", status: "available" });
    const response = await POST(request(), params());
    expect(response.status).toBe(409);
    expect(mocks.generateInstructionPdfArtifact).not.toHaveBeenCalled();
  });

  it("generation_failedからは再試行を実行し200を返す", async () => {
    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    expect(mocks.generateInstructionPdfArtifact).toHaveBeenCalledWith("order-1");
  });

  it("再試行が例外を投げた場合は502で明確な日本語エラーを返す(500クラッシュにしない)", async () => {
    mocks.generateInstructionPdfArtifact.mockRejectedValue(new Error("boom"));
    const response = await POST(request(), params());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "再試行に失敗しました。時間をおいて再度お試しください。",
    });
  });
});
