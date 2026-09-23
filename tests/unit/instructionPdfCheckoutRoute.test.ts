import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  findFirstDiagnosis: vi.fn(),
  getLatestSubscription: vi.fn(),
  requestInstructionPdfOrder: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: { diagnosis: { findFirst: mocks.findFirstDiagnosis } },
}));
vi.mock("@/server/db/billingRepository", () => ({
  getLatestSubscriptionByClinicId: mocks.getLatestSubscription,
}));
vi.mock("@/server/services/optionOrders/requestInstructionPdfOrder", () => ({
  requestInstructionPdfOrder: mocks.requestInstructionPdfOrder,
  InstructionPdfOrderError: class InstructionPdfOrderError extends Error {},
}));

import { POST } from "@/app/api/options/instruction-pdf/checkout/route";

function request(body: Record<string, unknown>, origin = "https://dent-shift.example.com") {
  return new NextRequest("https://dent-shift.example.com/api/options/instruction-pdf/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({
    id: "contact-1",
    clinicId: "clinic-1",
    email: "owner@example.com",
  });
  mocks.findFirstDiagnosis.mockResolvedValue({ id: "report-1" });
  mocks.getLatestSubscription.mockResolvedValue({ status: "active", plan: "standard", billingExempt: false });
  mocks.requestInstructionPdfOrder.mockResolvedValue({ orderId: "order-1", status: "draft" });
});

describe("POST /api/options/instruction-pdf/checkout: 機能制限", () => {
  it.each(["past_due", "restricted", "suspended", "cancelled"] as const)(
    "status=%sの場合は403を返し注文を作成しない",
    async (status) => {
      mocks.getLatestSubscription.mockResolvedValue({ status, plan: "standard", billingExempt: false });
      const response = await POST(request({ reportId: "report-1" }));
      expect(response.status).toBe(403);
      expect(mocks.requestInstructionPdfOrder).not.toHaveBeenCalled();
    }
  );

  it.each(["active", "trial", "cancel_scheduled"] as const)(
    "status=%sの場合は通常どおり注文できる",
    async (status) => {
      mocks.getLatestSubscription.mockResolvedValue({ status, plan: "standard", billingExempt: false });
      const response = await POST(request({ reportId: "report-1" }));
      expect(response.status).toBe(200);
      expect(mocks.requestInstructionPdfOrder).toHaveBeenCalledTimes(1);
    }
  );

  it("billingExempt(永久無料)はstatusにかかわらず注文できる", async () => {
    mocks.getLatestSubscription.mockResolvedValue({ status: "cancelled", plan: "standard", billingExempt: true });
    const response = await POST(request({ reportId: "report-1" }));
    expect(response.status).toBe(200);
    expect(mocks.requestInstructionPdfOrder).toHaveBeenCalledTimes(1);
  });

  it("契約がない場合(未契約)は制限せず注文できる(planIdはnullで都度課金扱い)", async () => {
    mocks.getLatestSubscription.mockResolvedValue(null);
    const response = await POST(request({ reportId: "report-1" }));
    expect(response.status).toBe(200);
    expect(mocks.requestInstructionPdfOrder).toHaveBeenCalledTimes(1);
  });
});
