#!/usr/bin/env bash
set -uo pipefail

# 2026-09-29追加(PO承認: dent-shift-test-db/mainへのmigration適用)。
#
# 標準の`prisma migrate deploy`を使う(ブラウザSQL Editorへの手入力ではなく、
# レポジトリに既にコミットされているmigration.sqlファイルをPrisma自身が読んで適用する、
# 「盲目的な入力」ではない標準ツール)。適用前に:
# 1. .env.main-migration-apply の存在だけを確認する(中身は一切読まない)。
# 2. diagnose-main-migration-env-format.mjs による事前チェック(接続なし、値は
#    一切出力しない)。失敗した場合は接続・適用を一切行わずここで停止する。
# 3. `prisma migrate status`(読み取りのみ)で、未適用migrationが
#    "20260929130000_add_diagnosis_rate_limit"の1件だけであることを確認する。
#    それ以外の差分がある場合は適用せずここで停止する。
# 4. 上記が確認できた場合のみ`prisma migrate deploy`を実行する。
#    `_prisma_migrations`の手動編集は行わない(Prisma自身が記録する)。
# 5. 手順2〜4のどこで失敗しても、ローカル開発用(SQLite)のPrisma Clientを必ず元に戻す。

ENV_FILE=".env.main-migration-apply"
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
  exit 1
fi

echo "接続前の事前チェック(値は出力しません)を行っています..."
if ! node --env-file="$ENV_FILE" scripts/diagnose-main-migration-env-format.mjs; then
  echo "エラー: 事前チェックに失敗しました。DB接続・Prisma Client生成は一切行っていません。"
  exit 1
fi

echo "Postgres用Prisma Clientを生成しています..."
if ! npx prisma generate --schema prisma/postgres/schema.prisma > /dev/null; then
  echo "エラー: Prisma Client(Postgres)の生成に失敗しました。"
  exit 1
fi

echo "migration状態を確認しています(読み取りのみ、まだ適用しません)..."
STATUS_OUTPUT=$(DATABASE_URL="$(node --env-file="$ENV_FILE" -e 'console.log(process.env.MAIN_TEST_DB_DATABASE_URL)')" npx prisma migrate status --schema prisma/postgres/schema.prisma 2>&1)
STATUS_EXIT=$?
# DATABASE_URL自体を出力しないよう、この行の中間結果はコマンド置換のみで完結させ、
# 変数に一切格納・echoしない。STATUS_OUTPUTには接続文字列は含まれない
# (prisma migrate statusの標準出力はmigration名の一覧のみ)。
echo "$STATUS_OUTPUT"

PENDING_COUNT=$(echo "$STATUS_OUTPUT" | grep -c "20260929130000_add_diagnosis_rate_limit" || true)
OTHER_PENDING=$(echo "$STATUS_OUTPUT" | grep -E "have not yet been applied|following migration" -A 20 | grep -E "^\s*•|^\s*-" | grep -v "20260929130000_add_diagnosis_rate_limit" || true)

if [ -n "$OTHER_PENDING" ]; then
  echo "エラー: 想定外の未適用migrationが検出されました。適用を停止します:"
  echo "$OTHER_PENDING"
  exit 1
fi

if [ "$PENDING_COUNT" -lt 1 ]; then
  echo "エラー: 想定するmigration(20260929130000_add_diagnosis_rate_limit)が未適用として" \
       "検出できませんでした。想定外の状態のため適用を停止します。"
  exit 1
fi

echo "未適用migrationは20260929130000_add_diagnosis_rate_limitの1件のみと確認しました。適用します..."
DATABASE_URL="$(node --env-file="$ENV_FILE" -e 'console.log(process.env.MAIN_TEST_DB_DATABASE_URL)')" npx prisma migrate deploy --schema prisma/postgres/schema.prisma
DEPLOY_EXIT=$?

exit $DEPLOY_EXIT
