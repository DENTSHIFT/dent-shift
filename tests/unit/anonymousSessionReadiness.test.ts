import { describe, expect, it, vi } from "vitest";
import { createAnonymousSessionReadinessGate } from "@/app/diagnosis/anonymousSessionReadiness";

/**
 * 2026-09-29追加(PO指摘、匿名Cookie初回リクエスト対策P0、2回目): 診断フォーム送信
 * (submitDiagnosis, src/app/diagnosis/page.tsx)が、匿名主体の冪等性principalKeyに
 * 使うセッションcookieの確立を必ず待ってから送信し、取得が遅い場合・失敗する場合を
 * 正しく扱えることを検証する。DOM/Reactには依存しないため、fetchをモックした
 * プレーンなPromiseベースのテストとして書ける(jsdom/RTL不要)。
 */
describe("createAnonymousSessionReadinessGate", () => {
  it("GETが成功したら解決する", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const ensureReady = createAnonymousSessionReadinessGate(fetchMock);

    await expect(ensureReady()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/diagnosis/session",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("取得が遅い場合、解決するまで呼び出し元を待たせ続ける(タイムアウトせず、遅延後には正しく解決する)", async () => {
    let resolveFetch!: (value: Response) => void;
    const slowFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const ensureReady = createAnonymousSessionReadinessGate(slowFetch);

    let settled = false;
    const promise = ensureReady().then(() => {
      settled = true;
    });

    // マイクロタスクを何度flushしても、fetch自体が解決するまでは完了しない。
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveFetch({ ok: true } as Response);
    await promise;
    expect(settled).toBe(true);
  });

  it("GETがネットワークエラーで失敗した場合、rejectする(呼び出し元はPOST /api/diagnosisを送らない設計の前提)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    const ensureReady = createAnonymousSessionReadinessGate(fetchMock);

    await expect(ensureReady()).rejects.toThrow("network error");
  });

  it("GETがHTTPエラーステータスで返ってきた場合も失敗として扱う(ok:falseはthrow)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const ensureReady = createAnonymousSessionReadinessGate(fetchMock);

    await expect(ensureReady()).rejects.toThrow(/500/);
  });

  it("成功後の再呼び出しは、GETを再送せず同じ解決済みPromiseを返す(cookieが既に確立済みのため)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const ensureReady = createAnonymousSessionReadinessGate(fetchMock);

    await ensureReady();
    await ensureReady();
    await ensureReady();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("失敗後の再呼び出しは、新しいGETで再試行する(「もう一度診断する」からの再送信で自然に回復できる)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValueOnce({ ok: true } as Response);
    const ensureReady = createAnonymousSessionReadinessGate(fetchMock);

    await expect(ensureReady()).rejects.toThrow("first attempt failed");
    await expect(ensureReady()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("解決前に複数回呼ばれても、GETは1回しか送らない(同時押下・複数フックからの呼び出しを1本化)", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const ensureReady = createAnonymousSessionReadinessGate(fetchMock);

    const p1 = ensureReady();
    const p2 = ensureReady();
    const p3 = ensureReady();

    resolveFetch({ ok: true } as Response);
    await Promise.all([p1, p2, p3]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
