import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  requestInviteCheckout: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/services/invites/requestInviteCheckout", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/services/invites/requestInviteCheckout")
  >("@/server/services/invites/requestInviteCheckout");
  return { ...actual, requestInviteCheckout: mocks.requestInviteCheckout };
});

import { POST } from "@/app/api/invites/[code]/checkout/route";
import { InviteCheckoutError } from "@/server/services/invites/requestInviteCheckout";

function request(origin = "https://dent-shift.example.com") {
  return new NextRequest("https://dent-shift.example.com/api/invites/ABC123/checkout", {
    method: "POST",
    headers: { origin },
  });
}
function params(code = "ABC123") {
  return { params: Promise.resolve({ code }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({ id: "contact-1", clinicId: "clinic-1", email: "owner@example.com" });
  mocks.requestInviteCheckout.mockResolvedValue({ checkoutUrl: "https://checkout.stripe.com/c/pay/invite" });
});

describe("POST /api/invites/[code]/checkout", () => {
  it("未ログインは401", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = await POST(request(), params());
    expect(response.status).toBe(401);
    expect(mocks.requestInviteCheckout).not.toHaveBeenCalled();
  });

  it("別サイトからの送信は403", async () => {
    const response = await POST(request("https://evil.example.com"), params());
    expect(response.status).toBe(403);
    expect(mocks.requestInviteCheckout).not.toHaveBeenCalled();
  });

  it("正常系はcheckoutUrlを返す", async () => {
    const response = await POST(request(), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checkoutUrl: "https://checkout.stripe.com/c/pay/invite" });
    expect(mocks.requestInviteCheckout).toHaveBeenCalledWith({
      inviteCode: "ABC123",
      clinicId: "clinic-1",
      contactEmail: "owner@example.com",
    });
  });

  it("招待が無効(not_found)なら404", async () => {
    mocks.requestInviteCheckout.mockRejectedValue(new InviteCheckoutError("無効です", "not_found"));
    const response = await POST(request(), params());
    expect(response.status).toBe(404);
  });

  it("メール不一致(email_mismatch)なら403", async () => {
    mocks.requestInviteCheckout.mockRejectedValue(new InviteCheckoutError("不一致です", "email_mismatch"));
    const response = await POST(request(), params());
    expect(response.status).toBe(403);
  });

  it("Stripeエラー(stripe_error)なら502", async () => {
    mocks.requestInviteCheckout.mockRejectedValue(new InviteCheckoutError("失敗しました", "stripe_error"));
    const response = await POST(request(), params());
    expect(response.status).toBe(502);
  });
});
