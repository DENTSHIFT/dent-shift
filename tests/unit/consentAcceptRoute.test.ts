import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentContact: vi.fn(),
  update: vi.fn(),
  activateTrialIfEligible: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.getCurrentContact }));
vi.mock("@/server/db/prismaClient", () => ({ prisma: { contact: { update: mocks.update } } }));
vi.mock("@/server/services/activateTrial", () => ({
  activateTrialIfEligible: mocks.activateTrialIfEligible,
}));

import { POST } from "@/app/api/auth/consent/accept/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.activateTrialIfEligible.mockResolvedValue(undefined);
});

describe("POST /api/auth/consent/accept", () => {
  it("未ログインなら401", async () => {
    mocks.getCurrentContact.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it("registrationStepを次(completed)へ前進させる(自分自身への遷移で足踏みしない回帰防止)", async () => {
    mocks.getCurrentContact.mockResolvedValue({ id: "contact_1", registrationStep: "consent" });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "contact_1" },
      data: expect.objectContaining({ registrationStep: "completed" }),
    });
  });

  it("同意後にtrial活性化条件を確認する", async () => {
    mocks.getCurrentContact.mockResolvedValue({ id: "contact_2", registrationStep: "consent" });
    await POST();
    expect(mocks.activateTrialIfEligible).toHaveBeenCalledWith("contact_2");
  });
});
