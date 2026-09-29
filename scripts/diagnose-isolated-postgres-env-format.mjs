// 2026-09-29追加・修正(PO指摘: 不正行・プレースホルダー・接続先不一致があれば、
// 値を出力せず接続前に停止すること。--env-fileが不正行を無視するだけでは検証不足)。
//
// この診断・ゲートスクリプトは、DATABASE_URL値そのものを一切出力しない。出力するのは
// 「読み込まれているか」「プレースホルダーのままでないか」「URLとして解釈できるか」
// 「接続先ホストが承認済み隔離ブランチのものと一致するか」という構造的な真偽値・
// ホスト名(ホスト名自体は秘密情報ではない)だけである。process.envはNodeの
// --env-fileフラグ経由で渡される想定(シェルのsourceは一切使わない呼び出し元前提)。
//
// いずれかのチェックに失敗した場合、exit code 1で終了する。呼び出し元
// (run-isolated-postgres-verification.sh)はこのスクリプトが成功した場合のみ
// 次のステップ(Prisma Client生成・実際のDB接続)へ進む。つまり、この段階では
// まだ一切DBへ接続していない(文字列としての静的検証のみ)。
const PLACEHOLDER = "PASTE_DIRECT_CONNECTION_STRING_HERE";

// 承認済み隔離ブランチ(dent-shift-test-db / isolated-verify-diagnosis-ratelimit-20260929)の
// Postgresエンドポイントホスト名。2026-09-29にNeon ConsoleのConnectダイアログで
// このブランチ専用として確認済み(ホスト名自体は秘密情報ではない。パスワードは
// 含まない)。Direct connectionの場合は"-pooler"接尾辞が付かない形になる。
const EXPECTED_HOST_SUFFIXES = [
  "ep-withered-boat-b3wdv117.c-4.ap-southeast-1.aws.neon.tech",
  "ep-withered-boat-b3wdv117-pooler.c-4.ap-southeast-1.aws.neon.tech",
];

function fail(message) {
  console.error(`[preflight] NG: ${message}`);
  process.exit(1);
}

const raw = process.env.ISOLATED_POSTGRES_DATABASE_URL;

if (raw === undefined || raw.trim().length === 0) {
  fail("ISOLATED_POSTGRES_DATABASE_URL が読み込まれていません(未設定・空)。");
}

if (raw === PLACEHOLDER) {
  fail(
    ".env.isolated-postgres-verify がまだプレースホルダーのままです。" +
      "実際の接続文字列に置き換えてから再実行してください。"
  );
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
    `接続先ホスト名が承認済み隔離ブランチ(isolated-verify-diagnosis-ratelimit-20260929)の` +
      `ものと一致しません。誤ってmain等、別ブランチ・別プロジェクトの接続文字列が` +
      `設定されている可能性があります。接続を一切行わずここで停止します。`
  );
}

console.log("[preflight] OK: 形式・接続先ホストとも承認済み隔離ブランチと一致しました。");
console.log(`[preflight]   hostname: ${url.hostname}`);
console.log(`[preflight]   database: ${url.pathname.replace(/^\//, "")}`);
process.exit(0);
