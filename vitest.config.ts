import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 結合テストはファイルごとにDATABASE_URLを一時DBへ差し替える。
    // worker thread間の環境変数共有に依存せず、OSプロセス単位で明示的に分離する。
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Vitest専用のtest-environment adapter(2026-09-08のユーザー指示)。
      // 実際の"server-only" packageはpackage.jsonのexports条件分岐で
      // "react-server"条件時はempty.js(no-op)、それ以外はindex.js(無条件throw)
      // へ解決される。Next.js本体はServer Componentのbundle時に"react-server"
      // 条件を付与するためempty.jsへ解決されるが、VitestはこのNext.js固有の
      // 条件を認識しないため、常にindex.js(throw)側へ解決してしまう。
      // これがMac実機で観測された
      // "This module cannot be imported from a Client Component module"の原因。
      // このaliasはVitestの実行(このvitest.config.tsのみ)にだけ適用され、
      // Next.js本体のwebpack/turbopack設定(next.config.*)には一切影響しない。
      // production側の`import "server-only";`文自体は削除しておらず、
      // server-only dependency自体もpackage.jsonに残したまま
      // (Next.js production/buildでは引き続き実packageの"react-server"条件が
      // 使われる)。
      "server-only": path.resolve(__dirname, "./tests/stubs/serverOnlyStub.ts"),
    },
  },
});
