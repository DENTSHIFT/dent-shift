#!/usr/bin/env bash
set -uo pipefail

# 2026-09-29修正(PO指摘、2回目: --env-fileが不正行を無視するだけでは検証不足。
# 不正行・プレースホルダー・接続先不一致があれば、値を出力せず接続前に停止すること)。
#
# 旧版は`--env-file`で読み込んだ値をそのままPrisma Client生成・DB接続へ渡していた。
# `--env-file`は形式不正な行を無視するだけで、「値が空/プレースホルダーのまま/
# 別ブランチの接続文字列」といったケースを弾かない。これらのケースを弾かないまま
# 進むと、意図しない接続先(最悪の場合main)へ接続してしまうリスクが残る。
#
# 対応: Prisma Client生成・vitest実行(=実際のDB接続を伴う処理)の前に、
# scripts/diagnose-isolated-postgres-env-format.mjs による静的な事前チェックを必須の
# ゲートとして挟む。このチェックはDATABASE_URL値を一切出力せず、
# 「読み込まれているか」「プレースホルダーのままでないか」「URLとして解釈できるか」
# 「接続先ホストが承認済み隔離ブランチのものと一致するか」だけを検証する。
# このチェックが失敗した場合、Prisma Client生成もDB接続も一切行わずスクリプトを
# 停止する(=不正な設定のまま接続を試みることがない)。
#
# このスクリプトは:
# 1. .env.isolated-postgres-verify の存在だけを確認する(中身は一切読まない・表示しない)。
# 2. diagnose-isolated-postgres-env-format.mjs による事前チェック(接続なし)。
#    失敗した場合はここで停止する。
# 3. prisma/postgres/schema.prisma でPrisma Clientを生成する(接続不要、DDL操作もしない)。
# 4. `node --env-file=.env.isolated-postgres-verify` 経由でvitestを起動し、
#    tests/integration/isolatedPostgresConcurrency.test.ts だけを実行する
#    (`prisma migrate deploy`等のmigrationコマンドは一切実行しない。テストファイル
#    自身もbeforeAllで、既知のfingerprint行を確認できない限り接続先が違うとみなして
#    即abortする、二重の安全策)。
# 5. 手順3〜4のどこで失敗しても、ローカル開発用(SQLite)のPrisma Clientを必ず元に戻す
#    (下記のtrapで保証する)。

ENV_FILE=".env.isolated-postgres-verify"
RESTORE_DONE=0

restore_sqlite_client() {
  if [ "$RESTORE_DONE" -eq 1 ]; then
    return
  fi
  echo "ローカル開発用(SQLite)のPrisma Clientへ戻しています..."
  npx prisma generate --schema prisma/schema.prisma > /dev/null 2>&1
  RESTORE_DONE=1
}
trap restore_sqlite_client EXIT

if [ ! -f "$ENV_FILE" ]; then
  echo "エラー: $ENV_FILE が見つかりません。"
  echo "Neon Console (dent-shift-test-db / isolated-verify-diagnosis-ratelimit-20260929) の"
  echo "ConnectダイアログからDirect connectionの接続文字列を取得し、"
  echo "このファイルへ ISOLATED_POSTGRES_DATABASE_URL=\"...\" の1行だけを書いてください。"
  exit 1
fi

echo "接続前の事前チェック(値は出力しません)を行っています..."
if ! node --env-file="$ENV_FILE" scripts/diagnose-isolated-postgres-env-format.mjs; then
  echo "エラー: 事前チェックに失敗しました。DB接続・Prisma Client生成は一切行っていません。"
  echo "$ENV_FILE の内容を確認し、承認済み隔離ブランチの正しい接続文字列に置き換えてから再実行してください。"
  exit 1
fi

echo "Postgres用Prisma Clientを生成しています..."
if ! npx prisma generate --schema prisma/postgres/schema.prisma > /dev/null; then
  echo "エラー: Prisma Client(Postgres)の生成に失敗しました。"
  exit 1
fi

echo "隔離Postgresブランチに対して並行実行検証を実行しています..."
node --env-file="$ENV_FILE" ./node_modules/.bin/vitest run tests/integration/isolatedPostgresConcurrency.test.ts
TEST_EXIT_CODE=$?

exit $TEST_EXIT_CODE
