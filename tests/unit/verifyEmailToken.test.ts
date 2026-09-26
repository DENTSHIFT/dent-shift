import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
  activateTrialIfEligible: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: { contact: { findFirst: mocks.findFirst, update: mocks.update } },
}));
vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: mocks.enqueueIntegrationEvent,
}));
vi.mock("@/server/services/activateTrial", () => ({
  activateTrialIfEligible: mocks.activateTrialIfEligible,
}));

import { verifyEmailToken } from "@/server/services/verifyEmailToken";

const RAW_TOKEN = "raw-verify-token";
const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({
    id: "contact-1",
    email: "owner@example.com",
    clinicId: "clinic-1",
    registrationStep: "email",
    emailVerifiedAt: null,
    emailVerificationTokenHash: TOKEN_HASH,
    emailVerificationExpiresAt: new Date(Date.now() + 60_000),
  });
  mocks.update.mockResolvedValue({});
  mocks.enqueueIntegrationEvent.mockResolvedValue(undefined);
  mocks.activateTrialIfEligible.mockResolvedValue(undefined);
});

describe("verifyEmailToken", () => {
  it("該当するContactがなければinvalidエラー、DBは更新しない", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const result = await verifyEmailToken("unknown");
    expect(result).toEqual({ status: "error", code: "invalid", message: expect.any(String) });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("既に確認済みならalready_verifiedを返し、DBは更新しない", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "contact-1",
      email: "owner@example.com",
      clinicId: "clinic-1",
      registrationStep: "payment",
      emailVerifiedAt: new Date(),
      emailVerificationTokenHash: TOKEN_HASH,
      emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    });
    const result = await verifyEmailToken(RAW_TOKEN);
    expect(result).toEqual({ status: "already_verified", contactId: "contact-1", email: "owner@example.com" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("期限切れならexpiredエラー、DBは更新しない", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "contact-1",
      email: "owner@example.com",
      clinicId: "clinic-1",
      registrationStep: "email",
      emailVerifiedAt: null,
      emailVerificationTokenHash: TOKEN_HASH,
      emailVerificationExpiresAt: new Date(Date.now() - 1000),
    });
    const result = await verifyEmailToken(RAW_TOKEN);
    expect(result).toEqual({ status: "error", code: "expired", message: expect.any(String) });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("正常系: verifiedを返し、emailVerifiedAt設定・トークン削除・registrationStep前進・Salesforce連携を行う(次は規約同意ステップ)", async () => {
    const result = await verifyEmailToken(RAW_TOKEN);
    expect(result).toEqual({ status: "verified", contactId: "contact-1", email: "owner@example.com" });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: expect.objectContaining({
        emailVerifiedAt: expect.any(Date),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        registrationStep: "consent",
      }),
    });
    expect(mocks.enqueueIntegrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "email_verified", contactId: "contact-1" })
    );
    expect(mocks.activateTrialIfEligible).not.toHaveBeenCalled();
  });
});
