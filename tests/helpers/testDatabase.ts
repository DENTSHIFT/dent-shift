import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Vitest 2/Vite 5のbuiltin一覧は新しい`node:sqlite`をまだ解決できないため、
// Node実行時のrequireへ直接委譲する。
const nodeRequire = createRequire(import.meta.url);
type NodeSqliteModule = {
  DatabaseSync: new (databasePath: string) => {
    exec(sql: string): void;
    close(): void;
  };
};

function loadNodeSqlite(): NodeSqliteModule | null {
  try {
    return nodeRequire("node:sqlite") as NodeSqliteModule;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code === "ERR_UNKNOWN_BUILTIN_MODULE" || code === "MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

/**
 * Prismaのmigration.sqlを順番にSQLiteへ適用して、結合テスト用DBを作る。
 *
 * テストプロセス内から`npx prisma db push`を起動すると、Prismaがさらにschema engineを
 * 子プロセスとして起動する。多段の子プロセスが制限される実行環境でも結合テストを
 * 実行できるよう、Node内蔵のSQLiteへmigration SQLを直接渡す。
 */
export function applyPrismaMigrationsToTestDatabase(databasePath: string): void {
  const migrationsRoot = path.resolve(process.cwd(), "prisma/migrations");
  const migrationSql = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((migrationName) =>
      readFileSync(path.join(migrationsRoot, migrationName, "migration.sql"), "utf8")
    )
    .join("\n");

  const nodeSqlite = loadNodeSqlite();
  if (nodeSqlite) {
    const database = new nodeSqlite.DatabaseSync(databasePath);
    try {
      // DatabaseSync.exec()はSQLエラー時にthrowするため、不完全なスキーマを
      // 成功扱いにせずbeforeAllを確実に失敗させる。
      database.exec(migrationSql);
    } finally {
      database.close();
    }
    return;
  }

  // node:sqliteがないNode 20等ではSQLite CLIへフォールバックする。
  // -bailにより最初のSQLエラーで非0終了し、不完全なスキーマを成功扱いにしない。
  execFileSync(process.env.SQLITE3_BIN ?? "sqlite3", ["-bail", databasePath], {
    input: migrationSql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
