import { describe, expect, it } from "vitest";
import {
  safeFetch,
  isBlockedIp,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  type DnsLookupFn,
} from "@/server/net/safeUrlFetcher";

/**
 * 2026-09-29追加(PO指示): SSRF対策済みURL取得モジュールのセキュリティテスト。
 * fake transport(fetch実装の差し替え)とfake DNS lookupのみを使い、実ネットワークには
 * 一切接続しない。PO指定の全ケース(正常/robots拒否相当のcontent-type拒否/リダイレクト/
 * タイムアウト/巨大レスポンス/SSRF拒否)を網羅する。
 */

function textResponse(body: string, init: ResponseInit & { contentType?: string } = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", init.contentType ?? "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

function resolvesTo(...ips: string[]): DnsLookupFn {
  return async () => ips;
}

describe("isBlockedIp: プライベート/ループバック/リンクローカル/メタデータIPの判定", () => {
  it("ループバック(127.0.0.1)を拒否する", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
  });
  it("プライベートIP(10.x/172.16-31.x/192.168.x)を拒否する", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("172.32.0.1")).toBe(false); // 範囲外(private ではない)
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });
  it("リンクローカル/クラウドメタデータ(169.254.169.254)を拒否する", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("169.254.0.1")).toBe(true);
  });
  it("IPv6のループバック(::1)・リンクローカル(fe80::)・unique local(fd00::)を拒否する", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
  });
  it("グローバルIPは許可する", () => {
    expect(isBlockedIp("203.0.113.10")).toBe(false);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });
});

describe("safeFetch: 正常系", () => {
  it("HTMLを正常に取得できる(fake transport)", async () => {
    const html = "<html><body><h1>テスト歯科</h1></body></html>";
    const result = await safeFetch("https://clinic.example/", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () => textResponse(html),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe(html);
      expect(result.status).toBe(200);
    }
  });
});

describe("safeFetch: SSRF拒否", () => {
  it("スキームがhttp/https以外なら拒否する", async () => {
    const result = await safeFetch("file:///etc/passwd", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () => textResponse("<html></html>"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("disallowed_scheme");
  });

  it("80/443以外のポートを拒否する", async () => {
    const result = await safeFetch("https://clinic.example:8443/", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () => textResponse("<html></html>"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("disallowed_port");
  });

  it("localhostを拒否する(DNS解決を待たずホスト名で判定)", async () => {
    const result = await safeFetch("http://localhost/", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () => textResponse("<html></html>"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("blocked_resolved_ip");
  });

  it("URLに直接プライベートIPが書かれている場合も拒否する", async () => {
    const result = await safeFetch("http://192.168.1.1/", {
      dnsLookup: resolvesTo("203.0.113.10"), // 到達しないはず
      fetchImpl: async () => textResponse("<html></html>"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("blocked_resolved_ip");
  });

  it("クラウドメタデータIP(169.254.169.254)へのDNS解決結果を拒否する(DNS rebinding対策)", async () => {
    const result = await safeFetch("https://clinic.example/", {
      dnsLookup: resolvesTo("169.254.169.254"),
      fetchImpl: async () => textResponse("<html></html>"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("blocked_resolved_ip");
  });

  it("複数IPに解決され、1つでもブロック対象なら拒否する(DNS rebinding対策)", async () => {
    const result = await safeFetch("https://clinic.example/", {
      dnsLookup: resolvesTo("203.0.113.10", "127.0.0.1"),
      fetchImpl: async () => textResponse("<html></html>"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("blocked_resolved_ip");
  });

  it("URLにユーザー情報(認証情報)が埋め込まれている場合は拒否する", async () => {
    const result = await safeFetch("https://user:pass@clinic.example/", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () => textResponse("<html></html>"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_url");
  });
});

describe("safeFetch: リダイレクト", () => {
  it("安全なリダイレクト先へは追従する", async () => {
    let callCount = 0;
    const result = await safeFetch("https://clinic.example/old", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async (input) => {
        callCount++;
        const url = String(input);
        if (url === "https://clinic.example/old") {
          return new Response(null, { status: 301, headers: { location: "https://clinic.example/new" } });
        }
        return textResponse("<html>new</html>");
      },
    });
    expect(callCount).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalUrl).toBe("https://clinic.example/new");
  });

  it("リダイレクト先もプライベートIPなら拒否する(毎回同じ検証)", async () => {
    const result = await safeFetch("https://clinic.example/old", {
      dnsLookup: async (hostname) =>
        hostname === "internal.example" ? ["127.0.0.1"] : ["203.0.113.10"],
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === "https://clinic.example/old") {
          return new Response(null, { status: 302, headers: { location: "https://internal.example/" } });
        }
        return textResponse("<html></html>");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("blocked_resolved_ip");
  });

  it(`リダイレクト回数の上限(${MAX_REDIRECTS}回)を超えると拒否する`, async () => {
    let hop = 0;
    const result = await safeFetch("https://clinic.example/0", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () => {
        hop++;
        return new Response(null, { status: 302, headers: { location: `https://clinic.example/${hop}` } });
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_many_redirects");
  });
});

describe("safeFetch: タイムアウト", () => {
  it("fetch自体がタイムアウトした場合はtimeoutとして扱う", async () => {
    const result = await safeFetch("https://clinic.example/", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });
});

describe("safeFetch: 巨大レスポンス", () => {
  it(`Content-Lengthが上限(${MAX_RESPONSE_BYTES}バイト)を超える場合は拒否する`, async () => {
    const result = await safeFetch("https://clinic.example/", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () =>
        textResponse("x", {
          headers: { "content-type": "text/html", "content-length": String(MAX_RESPONSE_BYTES + 1) },
        }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("response_too_large");
  });

  it("Content-Length偽装(実際はストリームが上限を超える)も拒否する", async () => {
    const chunkSize = 1024 * 1024; // 1MB
    const chunks = Math.ceil(MAX_RESPONSE_BYTES / chunkSize) + 2;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < chunks; i++) {
          controller.enqueue(new Uint8Array(chunkSize).fill(97));
        }
        controller.close();
      },
    });
    const result = await safeFetch("https://clinic.example/", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () =>
        new Response(stream, { status: 200, headers: { "content-type": "text/html" } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("response_too_large");
  });
});

describe("safeFetch: Content-Type制限", () => {
  it("HTML/text/robots.txt以外のContent-Typeを拒否する(例: application/octet-stream)", async () => {
    const result = await safeFetch("https://clinic.example/file.bin", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () =>
        new Response("binary", { status: 200, headers: { "content-type": "application/octet-stream" } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("disallowed_content_type");
  });

  it("text/plain(robots.txt相当)は許可する", async () => {
    const result = await safeFetch("https://clinic.example/robots.txt", {
      dnsLookup: resolvesTo("203.0.113.10"),
      fetchImpl: async () =>
        new Response("User-agent: *\nDisallow:", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    });
    expect(result.ok).toBe(true);
  });
});
