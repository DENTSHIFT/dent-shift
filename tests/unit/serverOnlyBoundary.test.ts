import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * server-only境界の静的regression test(2026-09-08のユーザー指示)。
 *
 * vitest.config.tsで"server-only"をtest専用stub(tests/stubs/serverOnlyStub.ts)へ
 * aliasしているため、production側で`import "server-only";`が誤って削除されても
 * 通常のunit testは(importが単に無くなるだけで)そのままloadできてしまい、
 * production build時にだけ表面化するリスクがある。そのため、OPENAI_API_KEYを
 * 直接的または間接的に扱うproduction fileの先頭にこの宣言が実在することを、
 * ソースファイルを直接読んで確認する(脆いregexを大量に増やさないよう、
 * 対象は最小限の3ファイルのみに絞る)。
 */
const FILES_REQUIRING_SERVER_ONLY = [
  "src/server/providers/ai-measurement/openai/openAiSdkTransport.ts",
  "src/server/config/aiMeasurementConfig.ts",
  "src/server/composition/aiMeasurementProviderFactory.ts",
];

describe("server-only境界の静的regression", () => {
  it.each(FILES_REQUIRING_SERVER_ONLY)(
    '%s の先頭でimport "server-only"; が宣言されている',
    (relativePath) => {
      const content = readFileSync(resolve(process.cwd(), relativePath), "utf-8");
      expect(content).toMatch(/^import "server-only";/m);
    }
  );
});
