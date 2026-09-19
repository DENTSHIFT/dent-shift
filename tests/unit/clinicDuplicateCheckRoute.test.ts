import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  findDuplicate: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentContact: mocks.currentContact,
}));

vi.mock("@/server/db/clinicDuplicateRepository", () => ({
  findClinicDuplicateCandidate: mocks.findDuplicate,
}));

import { POST } from "@/app/api/clinics/duplicate-check/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/clinics/duplicate-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue(null);
  mocks.findDuplicate.mockResolvedValue(null);
});

describe("POST /api/clinics/duplicate-check", () => {
  it("未ログインで候補がある場合は内部医院IDを隠して一致種別と案内だけ返す", async () => {
    mocks.findDuplicate.mockResolvedValue({ clinicId: "secret-clinic-id", matchType: "same_domain" });

    const response = await POST(
      request({ clinicName: "さくら歯科", clinicUrl: "https://sakura.example.com" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.duplicateCandidate.matchType).toBe("same_domain");
    expect(body.duplicateCandidate.message).toContain("同じ公式サイト");
    expect(JSON.stringify(body)).not.toContain("secret-clinic-id");
  });

  it("ログイン中の再診断では候補検索を行わない", async () => {
    mocks.currentContact.mockResolvedValue({ clinicId: "session-clinic" });

    const response = await POST(
      request({ clinicName: "登録済み歯科", clinicUrl: "https://registered.example.com" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ duplicateCandidate: null });
    expect(mocks.findDuplicate).not.toHaveBeenCalled();
  });
});
