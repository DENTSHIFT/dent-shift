import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentContact, updateClinicProfile } = vi.hoisted(() => ({
  getCurrentContact: vi.fn(),
  updateClinicProfile: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ getCurrentContact }));
vi.mock("@/server/db/clinicProfileRepository", () => ({ updateClinicProfile }));

import { PATCH } from "@/app/api/clinics/me/route";

const req = (body: unknown, origin?: string) =>
  ({
    headers: new Headers(origin ? { origin } : {}),
    nextUrl: { origin: "https://test.dentshift.jp" },
    json: async () => body,
  }) as never;

const valid = { name: "テスト歯科", url: "https://example.com", directorName: "", gbpUrl: "", bookingUrl: "", contactPhone: "" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentContact.mockResolvedValue({ id: "contact-1", clinicId: "clinic-A" });
  updateClinicProfile.mockResolvedValue({ changed: ["name"] });
});

describe("PATCH /api/clinics/me", () => {
  it("未ログインは401で更新しない", async () => {
    getCurrentContact.mockResolvedValue(null);
    expect((await PATCH(req(valid))).status).toBe(401);
    expect(updateClinicProfile).not.toHaveBeenCalled();
  });
  it("更新先はログイン中のContactのclinicIdのみ(リクエストのclinicId/idは無視)", async () => {
    const res = await PATCH(req({ ...valid, clinicId: "clinic-B", id: "clinic-B" }));
    expect(res.status).toBe(200);
    expect(updateClinicProfile).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: "clinic-A", contactId: "contact-1" })
    );
    const values = updateClinicProfile.mock.calls[0]![0].values;
    expect(values).not.toHaveProperty("clinicId");
    expect(values).not.toHaveProperty("id");
  });
  it("検証エラーは項目別のメッセージ付きの400で更新しない", async () => {
    const res = await PATCH(req({ ...valid, name: "", url: "javascript:x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["name", "url"]);
    expect(updateClinicProfile).not.toHaveBeenCalled();
  });
  it("別オリジンからのリクエストは403", async () => {
    expect((await PATCH(req(valid, "https://evil.example"))).status).toBe(403);
    expect(updateClinicProfile).not.toHaveBeenCalled();
  });
  it("保存失敗は500の案内文で、値をログへ出さない", async () => {
    updateClinicProfile.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await PATCH(req({ ...valid, contactPhone: "03-1234-5678" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("03-1234");
    spy.mockRestore();
  });
  it("医院が存在しなければ404", async () => {
    updateClinicProfile.mockResolvedValue(null);
    expect((await PATCH(req(valid))).status).toBe(404);
  });
});
