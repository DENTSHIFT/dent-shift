import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentContact: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.getCurrentContact }));
vi.mock("@/server/db/prismaClient", () => ({ prisma: { contact: { update: mocks.update } } }));

import { POST } from "@/app/api/auth/consent/accept/route";

const VERIFIED = new Date("2026-09-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
});

describe("POST /api/auth/consent/accept", () => {
  it("未ログインなら401", async () => {
    mocks.getCurrentContact.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it("メール未確認なら409で同意を保存しない", async () => {
    mocks.getCurrentContact.mockResolvedValue({
      id: "contact_0",
      registrationStep: "email",
      emailVerifiedAt: null,
      consentAcceptedAt: null,
    });
    const response = await POST();
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("同意ステップでは同意日時を保存し、決済ステップ(payment)へ進める", async () => {
    mocks.getCurrentContact.mockResolvedValue({
      id: "contact_1",
      registrationStep: "consent",
      emailVerifiedAt: VERIFIED,
      consentAcceptedAt: null,
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "contact_1" },
      data: {
        consentAcceptedAt: expect.any(Date),
        registrationStep: "payment",
      },
    });
  });

  it("旧フローでpaymentに居る未同意ユーザーも同意日時を保存でき、ステップは後退・前進しない", async () => {
    mocks.getCurrentContact.mockResolvedValue({
      id: "contact_2",
      registrationStep: "payment",
      emailVerifiedAt: VERIFIED,
      consentAcceptedAt: null,
    });
    await POST();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "contact_2" },
      data: { consentAcceptedAt: expect.any(Date), registrationStep: "payment" },
    });
  });

  it("再同意しても最初の同意日時を上書きしない(冪等)", async () => {
    mocks.getCurrentContact.mockResolvedValue({
      id: "contact_3",
      registrationStep: "completed",
      emailVerifiedAt: VERIFIED,
      consentAcceptedAt: VERIFIED,
    });
    await POST();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "contact_3" },
      data: { consentAcceptedAt: VERIFIED, registrationStep: "completed" },
    });
  });
});
