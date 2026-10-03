import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  requireContact: vi.fn(),
}));

vi.mock("@/server/auth/requireContact", () => ({ requireContact: mocks.requireContact }));

import ConsultPage from "@/app/consult/page";

const ENV_KEY = "NEXT_PUBLIC_SPECIALIST_BOOKING_URL";
const SECRET_ENV_KEY = "TIMEREX_BOOKING_REF_SECRET";

/**
 * /consultはログイン中のContactのclinicIdだけからds_refを組み立て、呼び出し側が
 * 他医院のIDを指定して切り替える手段(クエリ・props等)を一切持たない(関数が
 * searchParams等を受け取らない)ことの回帰テスト。
 */
describe("/consult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env[ENV_KEY] = "https://timerex.net/s/team/cal";
    process.env[SECRET_ENV_KEY] = "test-secret";
  });

  it("requireContactが返したclinicIdだけでds_refを組み立てる", async () => {
    mocks.requireContact.mockResolvedValue({ clinicId: "clinic_me" });
    const tree = await ConsultPage();
    const html = renderToStaticMarkup(tree);
    expect(mocks.requireContact).toHaveBeenCalledTimes(1);
    expect(html).toContain("clinic_me");
    expect(html).not.toContain("clinic_other");
  });

  it("呼び出し元から医院IDを渡す引数が存在しない(型シグネチャ上も余分な引数を無視する)", async () => {
    mocks.requireContact.mockResolvedValue({ clinicId: "clinic_me" });
    // ConsultPageはsearchParams等を受け取らないため、呼び出し側が他医院のIDを
    // 注入しようとしても構造的に届かない。ここでは不正な引数を渡しても
    // 結果がrequireContactの戻り値だけに基づくことを確認する。
    // @ts-expect-error -- 意図的に存在しない引数を渡し、無視されることを確認する
    const tree = await ConsultPage({ searchParams: { clinicId: "clinic_other" } });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("clinic_me");
    expect(html).not.toContain("clinic_other");
  });

  it("NEXT_PUBLIC_SPECIALIST_BOOKING_URL未設定なら埋め込みを表示せず準備中の案内のみ", async () => {
    delete process.env[ENV_KEY];
    mocks.requireContact.mockResolvedValue({ clinicId: "clinic_me" });
    const tree = await ConsultPage();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("準備中");
  });
});
