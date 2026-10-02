#!/bin/zsh
# dent-shift-test (Vercel project) 限定で、ops管理者アカウントを1件だけ作成するための
# 本人実行専用スクリプト。Claude(AI)はこのスクリプトを実行しません。
#
# 安全対策:
#   - env pull の結果が [SENSITIVE] なら直ちに停止する(秘密値が取得できていないのに
#     誤った値で処理を進めない)。
#   - 取得したDATABASE_URLのホスト名に、dent-shift-test-db の既知のNeonプロジェクト識別子
#     (ep-restless-art-... / restless-art-55621985)が含まれることを確認してから処理を進める。
#     一致しなければ停止する(誤って別DB・本番DBに接続しない)。
#   - パスワードは `read -s` で非表示入力する。zsh(macOS標準)で動作確認済みの構文を使う。
#   - 一時ファイル・一時ディレクトリは mktemp で作成し、スクリプト終了時(正常終了・エラー・
#     Ctrl-C中断のいずれでも)に trap で必ず削除する。
#   - 既存の .env やリポジトリ直下の node_modules/@prisma/client は変更しない。
#     一時ディレクトリへコピーしたプロジェクトファイルの中だけで prisma generate を実行する。
#   - 新しいパスワード・DATABASE_URLの値は、このスクリプトの出力に一切表示しない。
#
# 使い方:
#   cd /Users/masatokimura/Documents/dent-shift
#   zsh scripts/create-test-operator-safely.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_NAME="dent-shift-test"
VERCEL_SCOPE="dentshift1"
EXPECTED_HOST_MARKERS=("restless-art-55621985" "ep-restless-art")

WORKDIR="$(mktemp -d /tmp/dentshift-ops-create.XXXXXX)"
# 失敗・中断時も含め、関数の戻り値に関わらず必ず最後に実行される。
cleanup() {
  local exit_code=$?
  rm -rf "$WORKDIR" 2>/dev/null || true
  unset DATABASE_URL OPERATOR_PASSWORD 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "==> 一時作業ディレクトリ: $WORKDIR (終了時に自動削除されます)"
echo "==> ${PROJECT_NAME} の環境変数を一時ディレクトリへ取得します(リポジトリ本体の .env には触れません)"

ENV_FILE="$WORKDIR/.env.pull"

(
  cd "$WORKDIR"
  npx --yes vercel@latest link --project="$PROJECT_NAME" --scope="$VERCEL_SCOPE" --yes >/dev/null
  npx --yes vercel@latest env pull "$ENV_FILE" --environment=production --scope="$VERCEL_SCOPE" --yes >/dev/null
)

if [ ! -f "$ENV_FILE" ]; then
  echo "エラー: 環境変数ファイルを取得できませんでした。中断します。" >&2
  exit 1
fi

DB_LINE="$(grep '^DATABASE_URL=' "$ENV_FILE" || true)"
if [ -z "$DB_LINE" ]; then
  echo "エラー: DATABASE_URL が見つかりませんでした。中断します。" >&2
  exit 1
fi

if echo "$DB_LINE" | grep -q '\[SENSITIVE\]'; then
  echo "エラー: DATABASE_URL が [SENSITIVE] のまま取得できませんでした。" >&2
  echo "        (Vercel側でSecret型のため、CLIでは平文を取得できない設定です)" >&2
  echo "        この先には進めません。中断します。" >&2
  exit 1
fi

# DATABASE_URL=".../....." の値部分だけを取り出す(値自体は表示しない)。
DB_URL="$(echo "$DB_LINE" | sed -E 's/^DATABASE_URL=//; s/^"(.*)"$/\1/')"
export DATABASE_URL="$DB_URL"

HOST_MATCHED=0
for marker in "${EXPECTED_HOST_MARKERS[@]}"; do
  if echo "$DATABASE_URL" | grep -q "$marker"; then
    HOST_MATCHED=1
    break
  fi
done

if [ "$HOST_MATCHED" -ne 1 ]; then
  echo "エラー: 取得した接続先のホスト名が、既知の dent-shift-test-db (Neon project" >&2
  echo "        restless-art-55621985) のものと一致しませんでした。誤った接続先の" >&2
  echo "        可能性があるため、安全のため中断します。" >&2
  exit 1
fi

echo "==> 接続先の検証に成功しました(dent-shift-test-db と一致)。値そのものは表示しません。"

echo "==> プロジェクトを一時ディレクトリへコピーし、そこだけで Prisma Client を再生成します"
# .git や node_modules 等の重いものは除外し、スキーマとpackage.json類だけをコピーする。
rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.next' \
  --exclude='.vercel' \
  "$REPO_ROOT"/ "$WORKDIR/project/"

(
  cd "$WORKDIR/project"
  npm install --no-audit --no-fund --omit=dev=false >/dev/null
  npx prisma generate --schema prisma/postgres/schema.prisma >/dev/null
)

echo ""
echo "==> 作成する管理者アカウントのメールアドレスを入力してください。"
read -r -p "Email: " OPERATOR_EMAIL
if [ -z "$OPERATOR_EMAIL" ]; then
  echo "エラー: メールアドレスが空です。中断します。" >&2
  exit 1
fi

echo "==> パスワードを入力してください(8文字以上、画面には表示されません)。"
read -r -s -p "Password: " OPERATOR_PASSWORD
echo ""
if [ -z "${OPERATOR_PASSWORD:-}" ] || [ "${#OPERATOR_PASSWORD}" -lt 8 ]; then
  echo "エラー: パスワードは8文字以上にしてください。中断します。" >&2
  exit 1
fi
export OPERATOR_PASSWORD

(
  cd "$WORKDIR/project"
  DATABASE_URL="$DATABASE_URL" OPERATOR_PASSWORD="$OPERATOR_PASSWORD" \
    npx tsx --conditions=react-server scripts/create-operator.ts --email="$OPERATOR_EMAIL" --role=admin
)

echo ""
echo "==> 完了しました。表示されたメールアドレス・パスワードで https://test.dentshift.jp/ops/login へログインしてください。"
echo "==> 一時ファイル・一時ディレクトリ・環境変数はこの後の終了処理で自動的に削除されます。"
