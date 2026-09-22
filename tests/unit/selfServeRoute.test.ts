import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  findFirst: vi.fn(),
  markImprovementActionSelfServe: vi.fn(),
  unmarkImprovementActionSelfServe: vi.fn(),
  recordClinicAuditLog: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/db/prismaClient", () => ({
  prisma: { diagnosis: { findFirst: mocks.findFirst } },
}));
vi.mock("@/server/db/improvementActionSelfServeRepository", () => ({
  markImprovementActionSelfServe: mocks.markImprovementActionSelfServe,
  unmarkImprovementActionSelfServe: mocks.unmarkImprovementActionSelfServe,
}));
vi.mock("@/server/db/clinicAuditLogRepository", () => ({
  recordClinicAuditLog: mocks.recordClinicAuditLog,
}));

import { POST, DELETE } from "@/app/api/improvement-actions/self-serve/route";

function request(method: "POST" | "DELETE", body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/improvement-actions/self-serve", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({ id: "contact-1", clinicId: "clinic-1" });
  mocks.findFirst.mockResolvedValue({ id: "report-1" });
});

describe("POST/DELETE /api/improvement-actions/self-serve", () => {
  it("未ログインは401", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = (await POST(request("POST", { reportId: "report-1", improvementActionKey: "task-1" })))!;
    expect(response.status).toBe(401);
    expect(mocks.markImprovementActionSelfServe).not.toHaveBeenCalled();
  });

  it("reportIdが自院の診断でなければ404(存在を漏らさない)", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = (await POST(request("POST", { reportId: "other-report", improvementActionKey: "task-1" })))!;
    expect(response.status).toBe(404);
    expect(mocks.markImprovementActionSelfServe).not.toHaveBeenCalled();
  });

  it("improvementActionKeyが無ければ400", async () => {
    const response = (await POST(request("POST", { reportId: "report-1" })))!;
    expect(response.status).toBe(400);
  });

  it("POSTでマークし、監査ログを記録する", async () => {
    const response = (await POST(request("POST", { reportId: "report-1", improvementActionKey: "task-1" })))!;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marked: true });
    expect(mocks.markImprovementActionSelfServe).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      contactId: "contact-1",
      reportId: "report-1",
      version: 1,
      improvementActionKey: "task-1",
    });
    expect(mocks.recordClinicAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "improvement_action_self_serve_marked" })
    );
  });

  it("DELETEで解除し、監査ログを記録する", async () => {
    const response = (await DELETE(
      request("DELETE", { reportId: "report-1", improvementActionKey: "task-1" })
    ))!;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marked: false });
    expect(mocks.unmarkImprovementActionSelfServe).toHaveBeenCalledWith({
      reportId: "report-1",
      version: 1,
      improvementActionKey: "task-1",
    });
    expect(mocks.recordClinicAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "improvement_action_self_serve_unmarked" })
    );
  });
});
