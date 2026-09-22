import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  contactFindUnique: vi.fn(),
  clinicFindUnique: vi.fn(),
  clinicCreate: vi.fn(),
  contactCreate: vi.fn(),
  findDuplicate: vi.fn(),
  hashPassword: vi.fn(),
  createSession: vi.fn(),
  setSessionCookie: vi.fn(),
  sendEmailVerification: vi.fn(),
  enqueueIntegrationEvent: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: {
    contact: {
      findUnique: mocks.contactFindUnique,
      create: mocks.contactCreate,
    },
    clinic: {
      findUnique: mocks.clinicFindUnique,
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

vi.mock("@/server/services/sendEmailVerification", () => ({
  sendEmailVerification: mocks.sendEmailVerification,
}));

vi.mock("@/server/db/integrationEventRepository", () => ({
  enqueueIntegrationEvent: mocks.enqueueIntegrationEvent,
}));

import { POST } from "@/app/api/auth/signup/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contactFindUnique.mockResolvedValue(null);
  mocks.findDuplicate.mockResolvedValue(null);
  mocks.hashPassword.mockResolvedValue("hashed");
  mocks.createSession.mockResolvedValue("token");
  mocks.setSessionCookie.mockResolvedValue(undefined);
  mocks.clinicCreate.mockResolvedValue({ id: "new-clinic", name: "既存候補歯科" });
  mocks.clinicFindUnique.mockResolvedValue({ id: "new-clinic", name: "既存候補歯科" });
  mocks.contactCreate.mockResolvedValue({ id: "new-contact" });
  mocks.sendEmailVerification.mockResolvedValue("sent");
  mocks.enqueueIntegrationEvent.mockResolvedValue(undefined);
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

  it("allowDuplicateClinic:trueで確認済みの場合は重複候補があっても新規登録を続行する(2026-09-22の手動E2Eで発見した行き詰まりバグの修正)", async () => {
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
          allowDuplicateClinic: true,
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.findDuplicate).not.toHaveBeenCalled();
    expect(mocks.clinicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "既存候補歯科" }) })
    );
    expect(mocks.contactCreate).toHaveBeenCalled();
  });

  it("allowDuplicateClinicが真偽値以外なら400", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new-owner@example.com",
          password: "password123",
          clinicName: "既存候補歯科",
          clinicUrl: "https://duplicate.example.com",
          allowDuplicateClinic: "yes",
        }),
      })
    );
    expect(response.status).toBe(400);
  });
});
