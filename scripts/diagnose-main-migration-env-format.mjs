// 2026-09-29追加: dent-shift-test-db / main へのmigration適用前の事前チェック。
// 値そのものは一切出力しない(長さ・プロトコル・ホスト名・データベース名のみ)。
// 隔離ブランチ用のdiagnose-isolated-postgres-env-format.mjsと同じ方針。
const PLACEHOLDER = "PASTE_DIRECT_CONNECTION_STRING_HERE";

// dent-shift-test-db / main のPostgresエンドポイントホスト名
// (2026-09-29にNeon ConsoleのConnectダイアログで確認済み。ホスト名自体は秘密情報ではない)。
const EXPECTED_HOST_SUFFIXES = [
  "ep-small-snow-b3srtm7d.c-4.ap-southeast-1.aws.neon.tech",
  "ep-small-snow-b3srtm7d-pooler.c-4.ap-southeast-1.aws.neon.tech",
];

function fail(message) {
  console.error(`[preflight:main] NG: ${message}`);
  process.exit(1);
}

const raw = process.env.MAIN_TEST_DB_DATABASE_URL;

if (raw === undefined || raw.trim().length === 0) {
  fail("MAIN_TEST_DB_DATABASE_URL が読み込まれていません(未設定・空)。");
}

if (raw === PLACEHOLDER) {
  fail(".env.main-migration-apply がまだプレースホルダーのままです。");
}

if (!/^postgres(ql)?:\/\//.test(raw)) {
  fail('値が "postgresql://" または "postgres://" で始まっていません(形式不正)。');
}

let url;
try {
  url = new URL(raw);
} catch {
  fail("値をURLとして解釈できません(形式不正)。");
}

if (!EXPECTED_HOST_SUFFIXES.includes(url.hostname)) {
  fail(
    "接続先ホスト名がdent-shift-test-db/mainのものと一致しません。誤って別ブランチ・" +
      "別プロジェクトの接続文字列が設定されている可能性があります。接続を一切行わずここで停止します。"
  );
}

console.log("[preflight:main] OK: 形式・接続先ホストともdent-shift-test-db/mainと一致しました。");
console.log(`[preflight:main]   hostname: ${url.hostname}`);
console.log(`[preflight:main]   database: ${url.pathname.replace(/^\//, "")}`);
process.exit(0);
