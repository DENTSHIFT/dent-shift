import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentContact: mocks.currentContact,
}));

import { GET } from "@/app/api/auth/me/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/me", () => {
  it("ログイン中は再診断に必要な自院情報だけを返す", async () => {
    mocks.currentContact.mockResolvedValue({
      id: "contact-1",
      clinicId: "clinic-1",
      email: "owner@example.com",
      passwordHash: "must-not-be-returned",
      clinic: {
        id: "clinic-1",
        name: "登録歯科医院",
        url: "https://clinic.example.com",
        contactPhone: "03-1234-5678",
        gbpUrl: null,
        bookingUrl: "https://clinic.example.com/book",
      },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authenticated: true,
      clinicName: "登録歯科医院",
      clinicUrl: "https://clinic.example.com",
      contactEmail: "owner@example.com",
      contactPhone: "03-1234-5678",
      gbpUrl: null,
      bookingUrl: "https://clinic.example.com/book",
    });
    expect(JSON.stringify(body)).not.toContain("must-not-be-returned");
    expect(body).not.toHaveProperty("clinicId");
    expect(body).not.toHaveProperty("contactId");
  });

  it("未ログインでは医院情報を返さない", async () => {
    mocks.currentContact.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
  });
});
