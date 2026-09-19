import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  contactFindUnique: vi.fn(),
  clinicCreate: vi.fn(),
  contactCreate: vi.fn(),
  findDuplicate: vi.fn(),
  hashPassword: vi.fn(),
  createSession: vi.fn(),
  setSessionCookie: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    contact: {
      findUnique: mocks.contactFindUnique,
      create: mocks.contactCreate,
    },
    clinic: {
      findUnique: vi.fn(),
      create: mocks.clinicCreate,
    },
  },
}));

vi.mock("@/server/db/clinicDuplicateRepository", () => ({
  findClinicDuplicateCandidate: mocks.findDuplicate,
}));

vi.mock("@/server/auth/password", () => ({
  hashPassword: mocks.hashPassword,
}));

vi.mock("@/server/auth/session", () => ({
  createSession: mocks.createSession,
  setSessionCookie: mocks.setSessionCookie,
}));

import { POST } from "@/app/api/auth/signup/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contactFindUnique.mockResolvedValue(null);
  mocks.findDuplicate.mockResolvedValue(null);
});

describe("POST /api/auth/signup: 医院重複候補", () => {
  it("候補がある場合は新しいClinic・Contactを作らず、ログイン案内を返す", async () => {
    mocks.findDuplicate.mockResolvedValue({
      clinicId: "secret-existing-clinic",
      matchType: "same_domain",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new-owner@example.com",
          password: "password123",
          clinicName: "既存候補歯科",
          clinicUrl: "https://duplicate.example.com",
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("clinic_duplicate_candidate");
    expect(body.error).toContain("ログイン");
    expect(JSON.stringify(body)).not.toContain("secret-existing-clinic");
    expect(mocks.clinicCreate).not.toHaveBeenCalled();
    expect(mocks.contactCreate).not.toHaveBeenCalled();
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
