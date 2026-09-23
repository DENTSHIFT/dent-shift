import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  sendOperatorPasswordResetEmail: vi.fn(),
}));

vi.mock("@/server/db/prismaClient", () => ({
  prisma: { operator: { findUnique: mocks.findUnique } },
}));
vi.mock("@/server/services/sendOperatorPasswordResetEmail", () => ({
  sendOperatorPasswordResetEmail: mocks.sendOperatorPasswordResetEmail,
}));

import { POST } from "@/app/api/ops/auth/forgot-password/route";

function request(body: unknown) {
  return new NextRequest("https://dent-shift.example.com/api/ops/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendOperatorPasswordResetEmail.mockResolvedValue("sent");
});

describe("POST /api/ops/auth/forgot-password", () => {
  it("存在するメールアドレスなら再設定メールを送信し、汎用メッセージを返す", async () => {
    mocks.findUnique.mockResolvedValue({ id: "operator-1", email: "ops@example.com" });
    const response = await POST(request({ email: "ops@example.com" }));
    expect(response.status).toBe(200);
    expect(mocks.sendOperatorPasswordResetEmail).toHaveBeenCalledWith({
      operatorId: "operator-1",
      email: "ops@example.com",
    });
    const data = await response.json();
    expect(data.message).toMatch(/該当するアカウントが存在する場合のみ/);
  });

  it("存在しないメールアドレスでも同一のレスポンス(存在有無を判別させない)", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const responseExisting = await (async () => {
      mocks.findUnique.mockResolvedValueOnce({ id: "operator-1", email: "ops@example.com" });
      return POST(request({ email: "ops@example.com" }));
    })();
    const dataExisting = await responseExisting.json();

    mocks.findUnique.mockResolvedValue(null);
    const responseMissing = await POST(request({ email: "nobody@example.com" }));
    const dataMissing = await responseMissing.json();

    expect(responseExisting.status).toBe(responseMissing.status);
    expect(dataExisting.message).toBe(dataMissing.message);
    expect(mocks.sendOperatorPasswordResetEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: "nobody@example.com" })
    );
  });

  it("メール送信が失敗しても、存在有無を漏らさないため同一の成功レスポンスを返す", async () => {
    mocks.findUnique.mockResolvedValue({ id: "operator-1", email: "ops@example.com" });
    mocks.sendOperatorPasswordResetEmail.mockRejectedValue(new Error("provider down"));
    const response = await POST(request({ email: "ops@example.com" }));
    expect(response.status).toBe(200);
  });

  it("メールアドレス未入力は400", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(mocks.sendOperatorPasswordResetEmail).not.toHaveBeenCalled();
  });
});
