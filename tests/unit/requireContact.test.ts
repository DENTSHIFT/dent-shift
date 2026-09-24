import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentContact: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.getCurrentContact }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { requireContact } from "@/server/auth/requireContact";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireContact", () => {
  it("未ログインは/loginへリダイレクト", async () => {
    mocks.getCurrentContact.mockResolvedValue(null);
    await expect(requireContact()).rejects.toThrow("REDIRECT:/login");
  });

  it("2026-09-24: SMS未認証(既定)は/verify-phoneへリダイレクトする(dashboard等への直接到達を防ぐ)", async () => {
    mocks.getCurrentContact.mockResolvedValue({ id: "c1", phoneVerifiedAt: null });
    await expect(requireContact()).rejects.toThrow("REDIRECT:/verify-phone");
  });

  it("nextを渡すとSMS未認証時のリダイレクト先にクエリとして保持される", async () => {
    mocks.getCurrentContact.mockResolvedValue({ id: "c1", phoneVerifiedAt: null });
    await expect(requireContact({ next: "/dashboard" })).rejects.toThrow(
      "REDIRECT:/verify-phone?next=%2Fdashboard"
    );
  });

  it("SMS認証済みなら通常どおりcontactを返す", async () => {
    const contact = { id: "c1", phoneVerifiedAt: new Date("2026-09-01T00:00:00Z") };
    mocks.getCurrentContact.mockResolvedValue(contact);
    await expect(requireContact()).resolves.toBe(contact);
  });

  it("requirePhoneVerified:falseならSMS未認証でもリダイレクトせず返す(/verify-phoneページ自身用)", async () => {
    const contact = { id: "c1", phoneVerifiedAt: null };
    mocks.getCurrentContact.mockResolvedValue(contact);
    await expect(requireContact({ requirePhoneVerified: false })).resolves.toBe(contact);
  });

  it("2026-09-24: smsVerificationExemptがtrueなら、SMS未認証でもリダイレクトせず返す(個別例外)", async () => {
    const contact = { id: "c1", phoneVerifiedAt: null, smsVerificationExempt: true };
    mocks.getCurrentContact.mockResolvedValue(contact);
    await expect(requireContact()).resolves.toBe(contact);
  });

  it("smsVerificationExemptがfalse(既定)の他ユーザーは、従来どおりSMS未認証で/verify-phoneへリダイレクトする", async () => {
    mocks.getCurrentContact.mockResolvedValue({ id: "c2", phoneVerifiedAt: null, smsVerificationExempt: false });
    await expect(requireContact()).rejects.toThrow("REDIRECT:/verify-phone");
  });
});
