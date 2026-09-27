import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 2026-09-28修正(PO再指摘): /api/dashboard/trial-ctaはGETの副作用化を避けるため
 * POSTのみを受け付ける。GET(Next.jsのprefetch・ブラウザ先読み・クローラー等)では
 * 一切イベントが記録されないこと、POSTでのみ記録されることを確認する。
 */

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: mocks.enqueueIntegrationEvent,
}));

import { POST } from "@/app/api/dashboard/trial-cta/route";

function postRequest(body: Record<string, string>, origin = "https://dent-shift.example.com") {
  const formData = new URLSearchParams(body);
  return new NextRequest("https://dent-shift.example.com/api/dashboard/trial-cta", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: formData.toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({ clinicId: "clinic-1", id: "contact-1" });
  mocks.enqueueIntegrationEvent.mockResolvedValue(undefined);
});

describe("POST /api/dashboard/trial-cta", () => {
  it("GETハンドラは存在しない(この経路がGETの副作用として動作しないことの構造的保証)", async () => {
    const routeModule = await import("@/app/api/dashboard/trial-cta/route");
    expect((routeModule as Record<string, unknown>).GET).toBeUndefined();
  });

  it("認証済みのPOSTで、clinicIdをセッションから取得してイベントを記録し、303で遷移する", async () => {
    const response = await POST(postRequest({ to: "/plans" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://dent-shift.example.com/plans");
    expect(mocks.enqueueIntegrationEvent).toHaveBeenCalledWith({
      eventType: "dashboard_trial_cta_clicked",
      clinicId: "clinic-1",
      contactId: "contact-1",
      payload: { to: "/plans" },
    });
  });

  it("未ログインは/loginへ303リダイレクトし、イベントは記録しない", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = await POST(postRequest({ to: "/plans" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://dent-shift.example.com/login");
    expect(mocks.enqueueIntegrationEvent).not.toHaveBeenCalled();
  });

  it("別サイトからのPOST(origin不一致)は403で拒否し、イベントを記録しない(CSRF対策)", async () => {
    const response = await POST(postRequest({ to: "/plans" }, "https://evil.example.com"));
    expect(response.status).toBe(403);
    expect(mocks.enqueueIntegrationEvent).not.toHaveBeenCalled();
  });

  it("外部URL・プロトコル相対URLへのtoはsafeNextPathで拒否し、/plansへフォールバックする(オープンリダイレクト対策)", async () => {
    const response = await POST(postRequest({ to: "https://evil.example.com/phish" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://dent-shift.example.com/plans");
  });

  it("toが未指定の場合は/plansへフォールバックする", async () => {
    const response = await POST(postRequest({}));
    expect(response.headers.get("location")).toBe("https://dent-shift.example.com/plans");
  });

  it("イベント記録が失敗しても、遷移自体は成功する(計測はベストエフォート)", async () => {
    mocks.enqueueIntegrationEvent.mockRejectedValue(new Error("db down"));
    const response = await POST(postRequest({ to: "/diagnosis" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://dent-shift.example.com/diagnosis");
  });
});
