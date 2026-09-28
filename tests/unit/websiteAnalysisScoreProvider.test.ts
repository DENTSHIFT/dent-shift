import { describe, expect, it } from "vitest";
import { WebsiteAnalysisScoreProvider } from "@/server/providers/scoring/websiteAnalysisScoreProvider";
import type { ScoreCriterionInput } from "@/server/providers/scoring/types";
import type { SafeFetchOverrides } from "@/server/net/safeUrlFetcher";

/**
 * 2026-09-29追加(PO指示、10/1 P0範囲): LLMO実測(crawler_access/structured_data/
 * content_clarity)のend-to-endテスト。fake transport(fetchImpl)+fake DNS lookupのみを
 * 使い、実ネットワークには一切接続しない。
 */

function baseInput(overrides: Partial<ScoreCriterionInput> = {}): ScoreCriterionInput {
  return {
    clinicName: "テスト歯科クリニック",
    clinicUrl: "https://clinic.example/",
    aiObservations: [],
    ...overrides,
  };
}

const GOOD_HTML = `<!doctype html>
<html><head>
<meta charset="utf-8">
<script type="application/ld+json">{"@type":"Dentist","name":"テスト歯科クリニック"}</script>
</head><body>
<h1>テスト歯科クリニックへようこそ</h1>
<h2>診療内容</h2>
<p>${"当院は虫歯治療・歯周病治療・予防歯科に力を入れています。".repeat(12)}</p>
</body></html>`;

function fakeFetchRouter(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`no fake route for ${url}`);
    return handler();
  }) as typeof fetch;
}

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
function textResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
}

describe("WebsiteAnalysisScoreProvider", () => {
  it("LLMO以外のdomainを渡すとthrowする(配線ミスの早期検知)", async () => {
    const provider = new WebsiteAnalysisScoreProvider();
    await expect(provider.score("AIO", baseInput())).rejects.toThrow();
  });

  it("正常系: robots.txt許可・JSON-LDあり・見出し/本文十分な場合、3項目とも高スコアで測定済みになる", async () => {
    const overrides: SafeFetchOverrides = {
      dnsLookup: async () => ["203.0.113.10"],
      fetchImpl: fakeFetchRouter({
        "https://clinic.example/": () => htmlResponse(GOOD_HTML),
        "https://clinic.example/robots.txt": () => textResponse("User-agent: *\nDisallow:\n"),
      }),
    };
    const provider = new WebsiteAnalysisScoreProvider(overrides);
    const result = await provider.score("LLMO", baseInput());

    const crawlerAccess = result.find((c) => c.key === "crawler_access")!;
    const structuredData = result.find((c) => c.key === "structured_data")!;
    const contentClarity = result.find((c) => c.key === "content_clarity")!;
    const infoConsistency = result.find((c) => c.key === "info_consistency")!;
    const contentProvenance = result.find((c) => c.key === "content_provenance")!;

    expect(crawlerAccess.status).toBe("measured");
    expect(crawlerAccess.score).toBe(crawlerAccess.maxScore);
    expect(structuredData.status).toBe("measured");
    expect(structuredData.score).toBe(structuredData.maxScore);
    expect(contentClarity.status).toBe("measured");
    expect(contentClarity.score).toBe(contentClarity.maxScore);
    // PO指示により10/1範囲外の2項目は引き続きunavailableのまま。
    expect(infoConsistency.status).toBe("unavailable");
    expect(infoConsistency.score).toBeNull();
    expect(contentProvenance.status).toBe("unavailable");
    expect(contentProvenance.score).toBeNull();
  });

  it("robots.txtで全AIクローラーが拒否されている場合、crawler_accessは減点される(0点扱いではなくmeasured)", async () => {
    const overrides: SafeFetchOverrides = {
      dnsLookup: async () => ["203.0.113.10"],
      fetchImpl: fakeFetchRouter({
        "https://clinic.example/": () => htmlResponse(GOOD_HTML),
        "https://clinic.example/robots.txt": () => textResponse("User-agent: *\nDisallow: /\n"),
      }),
    };
    const provider = new WebsiteAnalysisScoreProvider(overrides);
    const result = await provider.score("LLMO", baseInput());
    const crawlerAccess = result.find((c) => c.key === "crawler_access")!;
    expect(crawlerAccess.status).toBe("measured");
    expect(crawlerAccess.score).toBeGreaterThanOrEqual(0);
    expect(crawlerAccess.score).toBeLessThan(crawlerAccess.maxScore);
  });

  it("noindexが設定されている場合、crawler_accessは0点になる(取得不能ではなく実測0)", async () => {
    const noindexHtml = GOOD_HTML.replace("<head>", '<head><meta name="robots" content="noindex">');
    const overrides: SafeFetchOverrides = {
      dnsLookup: async () => ["203.0.113.10"],
      fetchImpl: fakeFetchRouter({
        "https://clinic.example/": () => htmlResponse(noindexHtml),
        "https://clinic.example/robots.txt": () => textResponse("User-agent: *\nDisallow:\n"),
      }),
    };
    const provider = new WebsiteAnalysisScoreProvider(overrides);
    const result = await provider.score("LLMO", baseInput());
    const crawlerAccess = result.find((c) => c.key === "crawler_access")!;
    expect(crawlerAccess.status).toBe("measured");
    expect(crawlerAccess.score).toBe(0);
  });

  it("JSON-LDが無い場合、structured_dataは0点(測定済み・取得不能ではない)", async () => {
    const overrides: SafeFetchOverrides = {
      dnsLookup: async () => ["203.0.113.10"],
      fetchImpl: fakeFetchRouter({
        "https://clinic.example/": () => htmlResponse("<html><body><h1>見出し</h1></body></html>"),
        "https://clinic.example/robots.txt": () => textResponse("User-agent: *\nDisallow:\n"),
      }),
    };
    const provider = new WebsiteAnalysisScoreProvider(overrides);
    const result = await provider.score("LLMO", baseInput());
    const structuredData = result.find((c) => c.key === "structured_data")!;
    expect(structuredData.status).toBe("measured");
    expect(structuredData.score).toBe(0);
  });

  it("robots.txtが取得できなくても(404扱いのnetwork_error)、制限なしとして扱いcrawler_accessは測定される", async () => {
    const overrides: SafeFetchOverrides = {
      dnsLookup: async () => ["203.0.113.10"],
      fetchImpl: fakeFetchRouter({
        "https://clinic.example/": () => htmlResponse(GOOD_HTML),
        "https://clinic.example/robots.txt": () => new Response(null, { status: 404 }),
      }),
    };
    const provider = new WebsiteAnalysisScoreProvider(overrides);
    const result = await provider.score("LLMO", baseInput());
    const crawlerAccess = result.find((c) => c.key === "crawler_access")!;
    expect(crawlerAccess.status).toBe("measured");
    expect(crawlerAccess.score).toBe(crawlerAccess.maxScore);
  });

  it("サイト本体の取得に失敗した場合(タイムアウト等)、crawler_access/structured_data/content_clarityは全てunavailableになり、0点扱いしない", async () => {
    const overrides: SafeFetchOverrides = {
      dnsLookup: async () => ["203.0.113.10"],
      fetchImpl: async () => {
        const err = new Error("timeout");
        err.name = "TimeoutError";
        throw err;
      },
    };
    const provider = new WebsiteAnalysisScoreProvider(overrides);
    const result = await provider.score("LLMO", baseInput());
    for (const key of ["crawler_access", "structured_data", "content_clarity"]) {
      const c = result.find((r) => r.key === key)!;
      expect(c.status).toBe("unavailable");
      expect(c.score).toBeNull();
      expect(c.unavailableReason).not.toBeNull();
    }
  });

  it("SSRF拒否対象のURL(プライベートIPへ解決)の場合も、診断全体を失敗させずunavailableとして返す", async () => {
    const overrides: SafeFetchOverrides = {
      dnsLookup: async () => ["127.0.0.1"],
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    };
    const provider = new WebsiteAnalysisScoreProvider(overrides);
    const result = await provider.score("LLMO", baseInput());
    const crawlerAccess = result.find((c) => c.key === "crawler_access")!;
    expect(crawlerAccess.status).toBe("unavailable");
    expect(crawlerAccess.unavailableReason).toBe("fetch_failed");
  });

  it("常に5criterionを返す(scoreCriteria.ts正本のLLMO定義と一致)", async () => {
    const overrides: SafeFetchOverrides = {
      dnsLookup: async () => ["203.0.113.10"],
      fetchImpl: fakeFetchRouter({
        "https://clinic.example/": () => htmlResponse(GOOD_HTML),
        "https://clinic.example/robots.txt": () => textResponse("User-agent: *\nDisallow:\n"),
      }),
    };
    const provider = new WebsiteAnalysisScoreProvider(overrides);
    const result = await provider.score("LLMO", baseInput());
    expect(result.map((c) => c.key).sort()).toEqual(
      ["crawler_access", "structured_data", "content_clarity", "info_consistency", "content_provenance"].sort()
    );
  });
});
