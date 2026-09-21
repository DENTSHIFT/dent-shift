import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentContact: vi.fn(),
  getOptionOrderById: vi.fn(),
  getArtifactByOrderId: vi.fn(),
  recordClinicAuditLog: vi.fn(),
  resolveArtifactEncryptionConfigFromProcessEnv: vi.fn(),
  decryptStoredPassword: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.currentContact }));
vi.mock("@/server/db/optionOrderRepository", () => ({
  getOptionOrderById: mocks.getOptionOrderById,
}));
vi.mock("@/server/db/generatedArtifactRepository", () => ({
  getArtifactByOrderId: mocks.getArtifactByOrderId,
}));
vi.mock("@/server/db/clinicAuditLogRepository", () => ({
  recordClinicAuditLog: mocks.recordClinicAuditLog,
}));
vi.mock("@/server/db/prismaClient", () => ({ prisma: {} }));
vi.mock("@/server/config/artifactEncryptionConfig", () => ({
  resolveArtifactEncryptionConfigFromProcessEnv: mocks.resolveArtifactEncryptionConfigFromProcessEnv,
  ArtifactEncryptionConfigError: class ArtifactEncryptionConfigError extends Error {},
}));
vi.mock("@/server/crypto/artifactPasswordCipher", () => ({
  decryptStoredPassword: mocks.decryptStoredPassword,
  ArtifactPasswordDecryptionError: class ArtifactPasswordDecryptionError extends Error {},
}));

import { GET } from "@/app/api/options/instruction-pdf/[orderId]/password/route";

function request() {
  return new NextRequest("https://dent-shift.example.com/api/options/instruction-pdf/order-1/password");
}
function params(orderId = "order-1") {
  return { params: Promise.resolve({ orderId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentContact.mockResolvedValue({ id: "contact-1", clinicId: "clinic-1" });
  mocks.getOptionOrderById.mockResolvedValue({ id: "order-1", clinicId: "clinic-1" });
  mocks.getArtifactByOrderId.mockResolvedValue({
    generationStatus: "generated",
    passwordEncrypted: "iv:tag:cipher",
  });
  mocks.resolveArtifactEncryptionConfigFromProcessEnv.mockReturnValue({ key: Buffer.alloc(32) });
  mocks.decryptStoredPassword.mockReturnValue("Ab3dEf9hJk2M");
});

describe("GET /api/options/instruction-pdf/[orderId]/password", () => {
  it("未ログインは401", async () => {
    mocks.currentContact.mockResolvedValue(null);
    const response = await GET(request(), params());
    expect(response.status).toBe(401);
  });

  it("他clinicの注文は404", async () => {
    mocks.getOptionOrderById.mockResolvedValue({ id: "order-1", clinicId: "other-clinic" });
    const response = await GET(request(), params());
    expect(response.status).toBe(404);
  });

  it("未生成はパスワードを返さず409", async () => {
    mocks.getArtifactByOrderId.mockResolvedValue({ generationStatus: "generating", passwordEncrypted: null });
    const response = await GET(request(), params());
    expect(response.status).toBe(409);
    expect(mocks.decryptStoredPassword).not.toHaveBeenCalled();
  });

  it("所有者かつ生成済みなら復号したパスワードを返し、監査ログを記録する", async () => {
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ password: "Ab3dEf9hJk2M" });
    expect(mocks.recordClinicAuditLog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: "artifact_password_revealed", targetId: "order-1" })
    );
  });
});
