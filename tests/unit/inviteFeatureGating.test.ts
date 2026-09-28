import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-09-29追加(PO判断): 招待機能(招待発行API・招待経由Checkout/Pilot・招待ページ・
 * ops招待画面)をINVITE_FEATURE_ENABLEDで一括休眠させる対応の回帰テスト。
 * API側(POST /api/ops/invites, /api/invites/[code]/checkout, /pilot-activate)の
 * ゲーティングは opsInvitesRoute.test.ts / inviteCheckoutRoute.test.ts /
 * pilotActivateRoute.test.ts側で確認済み。ここでは公開招待ページ・ops招待一覧
 * ページがフラグ無効時にnotFound()を呼ぶことを確認する。
 */
const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  resolveInviteFeatureConfig: vi.fn(),
  getInviteByCode: vi.fn(),
  getCurrentContact: vi.fn(),
  resolvePilotInviteConfig: vi.fn(),
  requireOperator: vi.fn(),
  listInvites: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/server/config/inviteFeatureConfig", () => ({
  resolveInviteFeatureConfigFromProcessEnv: mocks.resolveInviteFeatureConfig,
}));
vi.mock("@/server/db/inviteRepository", () => ({
  getInviteByCode: mocks.getInviteByCode,
  listInvites: mocks.listInvites,
}));
vi.mock("@/server/auth/session", () => ({ getCurrentContact: mocks.getCurrentContact }));
vi.mock("@/server/config/pilotInviteConfig", () => ({
  resolvePilotInviteConfigFromProcessEnv: mocks.resolvePilotInviteConfig,
}));
vi.mock("@/server/auth/requireOperator", () => ({ requireOperator: mocks.requireOperator }));
vi.mock("@/server/db/auditLogRepository", () => ({ recordAuditLog: mocks.recordAuditLog }));

import InvitePage from "@/app/invite/[code]/page";
import OpsInvitesPage from "@/app/ops/invites/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
});

describe("招待機能フラグ無効時の遮断", () => {
  it("INVITE_FEATURE_ENABLED=falseなら、公開招待ページ(/invite/[code])はnotFound()を呼ぶ(招待データを読みにも行かない)", async () => {
    mocks.resolveInviteFeatureConfig.mockReturnValue({ enabled: false });

    await expect(
      InvitePage({ params: Promise.resolve({ code: "ABC123" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.getInviteByCode).not.toHaveBeenCalled();
  });

  it("INVITE_FEATURE_ENABLED=falseなら、ops招待一覧ページ(/ops/invites)はnotFound()を呼ぶ(Operator権限チェック・一覧取得にも進まない)", async () => {
    mocks.resolveInviteFeatureConfig.mockReturnValue({ enabled: false });

    await expect(OpsInvitesPage()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.requireOperator).not.toHaveBeenCalled();
    expect(mocks.listInvites).not.toHaveBeenCalled();
  });
});
