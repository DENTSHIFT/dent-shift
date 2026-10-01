import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock("@/server/services/salesforceSync", () => ({ retryPendingIntegrationEvents: mocks.retry }));

import { GET } from "@/app/api/internal/salesforce/retry/route";

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/internal/salesforce/retry", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  mocks.retry.mockResolvedValue({ attempted: 3 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/internal/salesforce/retry", () => {
  it("Vercel上でCRON_SECRETが未設定なら実行せず503を返す(誰でも起動できる状態を防ぐ)", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("CRON_SECRETが設定されていれば、一致しないAuthorizationを401で拒否する", async () => {
    vi.stubEnv("CRON_SECRET", "secret-value");
    const response = await GET(request("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("正しいAuthorizationなら再試行を実行する", async () => {
    vi.stubEnv("CRON_SECRET", "secret-value");
    const response = await GET(request("Bearer secret-value"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ attempted: 3 });
  });

  it("ローカル(VERCEL未設定)でCRON_SECRETが無い場合のみ認証なしで実行できる", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(request());
    expect(response.status).toBe(200);
  });
});
