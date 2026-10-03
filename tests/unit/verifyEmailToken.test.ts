import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
  activateTrialIfEligible: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: { contact: { findFirst: mocks.findFirst, findUnique: mocks.findUnique, update: mocks.update } },
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
  mocks.findUnique.mockResolvedValue(null);
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

  describe("使用済みリンクの再アクセス(2026-10-03、PO承認)", () => {
    // 使用済みトークンは検証成功時にemailVerificationTokenHashがnull化されるため、
    // 同じトークンで再アクセスするとDB上はcontactが見つからず(findFirstがnullを返す)
    // invalidと区別がつかない。その際、呼び出し元から現在ログイン中のセッションの
    // contactId(sessionContactId)を渡せば、「本人が既に確認済みか」をサーバー側で
    // 確認した上でのみ穏当な案内に倒せることを確認する。

    it("(a) 未ログイン + 使用済みトークン: セッションが無いのでinvalidのまま(成功扱いにしない)", async () => {
      mocks.findFirst.mockResolvedValue(null); // トークンhashは既にnull化されて消えている
      const result = await verifyEmailToken(RAW_TOKEN, { sessionContactId: null });
      expect(result).toEqual({ status: "error", code: "invalid", message: expect.any(String) });
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("(b) ログイン済み本人 + 使用済みトークン: 本人が確認済みなのでalready_verifiedの穏当な案内にする", async () => {
      mocks.findFirst.mockResolvedValue(null);
      mocks.findUnique.mockResolvedValue({
        id: "contact-1",
        email: "owner@example.com",
        emailVerifiedAt: new Date(),
      });
      const result = await verifyEmailToken(RAW_TOKEN, { sessionContactId: "contact-1" });
      expect(result).toEqual({ status: "already_verified", contactId: "contact-1", email: "owner@example.com" });
      expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "contact-1" } });
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("(c) 無効/期限切れトークン単体: セッションが無ければ(本人確認できないため)成功扱いにしない", async () => {
      mocks.findFirst.mockResolvedValue(null);
      const result = await verifyEmailToken("completely-bogus-token");
      expect(result).toEqual({ status: "error", code: "invalid", message: expect.any(String) });
      expect(mocks.findUnique).not.toHaveBeenCalled();
    });

    it("(d) ログイン済みだが他人の使用済みトークン: セッション本人は未確認のままなので成功扱いにしない", async () => {
      mocks.findFirst.mockResolvedValue(null); // トークンは他人のものですでに消費・null化済み
      mocks.findUnique.mockResolvedValue({
        id: "contact-2",
        email: "someone-else-session@example.com",
        emailVerifiedAt: null, // ログイン中の本人はまだ未確認
      });
      const result = await verifyEmailToken(RAW_TOKEN, { sessionContactId: "contact-2" });
      expect(result).toEqual({ status: "error", code: "invalid", message: expect.any(String) });
      expect(mocks.update).not.toHaveBeenCalled();
    });
  });
});
