import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentOperator: vi.fn(),
  recordAuditLog: vi.fn(),
  getSalesforceRecordByExternalId: vi.fn(),
  clearSalesforceTokenCacheForTests: vi.fn(),
}));

vi.mock("@/server/auth/operatorSession", () => ({ getCurrentOperator: mocks.getCurrentOperator }));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));
vi.mock("@/server/providers/salesforce/salesforceClient", async () => {
  const actual = await vi.importActual<typeof import("@/server/providers/salesforce/salesforceClient")>(
    "@/server/providers/salesforce/salesforceClient"
  );
  return {
    ...actual,
    getSalesforceRecordByExternalId: mocks.getSalesforceRecordByExternalId,
    clearSalesforceTokenCacheForTests: mocks.clearSalesforceTokenCacheForTests,
  };
});

import { GET } from "@/app/api/ops/salesforce-connection-check/route";
import { SalesforceDeliveryError, ORG_MISMATCH_ERROR_CODE, OAUTH_ERROR_CODE } from "@/server/providers/salesforce/salesforceClient";

const SANDBOX_ENV = {
  SALESFORCE_CLIENT_ID: "client-id",
  SALESFORCE_CLIENT_SECRET: "client-secret",
  SALESFORCE_LOGIN_URL: "https://inspiration-customization-3670--dsverify.sandbox.my.salesforce.com",
  SALESFORCE_EXPECTED_ORG_ID: "00DBS000008Dj7Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentOperator.mockResolvedValue({ id: "operator-1", email: "ops@example.com", role: "admin" });
  mocks.recordAuditLog.mockResolvedValue(undefined);
  vi.unstubAllEnvs();
});

describe("GET /api/ops/salesforce-connection-check", () => {
  it("未ログインは401", async () => {
    mocks.getCurrentOperator.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mocks.getSalesforceRecordByExternalId).not.toHaveBeenCalled();
  });

  it("管理者以外は403", async () => {
    mocks.getCurrentOperator.mockResolvedValue({ id: "operator-1", email: "cs@example.com", role: "cs" });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mocks.getSalesforceRecordByExternalId).not.toHaveBeenCalled();
  });

  it("SALESFORCE_PROVIDER=disabledのままでも、資格情報が設定されていれば接続確認できる(provider gateを迂回する)", async () => {
    vi.stubEnv("SALESFORCE_PROVIDER", "disabled");
    for (const [key, value] of Object.entries(SANDBOX_ENV)) vi.stubEnv(key, value);
    mocks.getSalesforceRecordByExternalId.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(mocks.clearSalesforceTokenCacheForTests).toHaveBeenCalledTimes(1);
    expect(body.credentialsConfigured).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.orgIdMatches).toBe(true);
    expect(body.loginUrlIsSandboxHost).toBe(true);
    // 秘密値・組織ID・接続先URLそのものはレスポンスに出さない。
    expect(JSON.stringify(body)).not.toContain(SANDBOX_ENV.SALESFORCE_CLIENT_SECRET);
    expect(JSON.stringify(body)).not.toContain(SANDBOX_ENV.SALESFORCE_EXPECTED_ORG_ID);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("通常の同期処理(読み取り以外)は一切呼ばない", async () => {
    vi.stubEnv("SALESFORCE_PROVIDER", "disabled");
    for (const [key, value] of Object.entries(SANDBOX_ENV)) vi.stubEnv(key, value);
    mocks.getSalesforceRecordByExternalId.mockResolvedValue(null);

    await GET();

    expect(mocks.getSalesforceRecordByExternalId).toHaveBeenCalledTimes(1);
    const call = mocks.getSalesforceRecordByExternalId.mock.calls[0]![0];
    expect(call.sobject).toBe("Lead");
    // 存在しないであろう外部IDを読むだけで、作成・更新・削除系の関数は一切importしていない
    // (このテストファイル自体が upsert/update/delete 系をモックしていないことでも保証される)。
  });

  it("組織ID不一致なら orgIdMatches=false・connected=false を返す", async () => {
    vi.stubEnv("SALESFORCE_PROVIDER", "disabled");
    for (const [key, value] of Object.entries(SANDBOX_ENV)) vi.stubEnv(key, value);
    mocks.getSalesforceRecordByExternalId.mockRejectedValue(
      new SalesforceDeliveryError("org mismatch", ORG_MISMATCH_ERROR_CODE)
    );

    const res = await GET();
    const body = await res.json();

    expect(body.connected).toBe(false);
    expect(body.orgIdMatches).toBe(false);
    expect(body.errorCode).toBe(ORG_MISMATCH_ERROR_CODE);
  });

  it("OAuth自体が失敗したら connected=false を返す", async () => {
    vi.stubEnv("SALESFORCE_PROVIDER", "disabled");
    for (const [key, value] of Object.entries(SANDBOX_ENV)) vi.stubEnv(key, value);
    mocks.getSalesforceRecordByExternalId.mockRejectedValue(new SalesforceDeliveryError("oauth failed", OAUTH_ERROR_CODE));

    const res = await GET();
    const body = await res.json();

    expect(body.connected).toBe(false);
    expect(body.errorCode).toBe(OAUTH_ERROR_CODE);
  });

  it("資格情報が未設定なら credentialsConfigured=false を返し、接続は試みない", async () => {
    vi.stubEnv("SALESFORCE_PROVIDER", "disabled");
    vi.stubEnv("SALESFORCE_CLIENT_ID", "");
    vi.stubEnv("SALESFORCE_CLIENT_SECRET", "");
    vi.stubEnv("SALESFORCE_LOGIN_URL", "");
    vi.stubEnv("SALESFORCE_EXPECTED_ORG_ID", "");

    const res = await GET();
    const body = await res.json();

    expect(body.credentialsConfigured).toBe(false);
    expect(mocks.getSalesforceRecordByExternalId).not.toHaveBeenCalled();
  });
});
