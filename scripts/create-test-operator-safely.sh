#!/bin/zsh
# dent-shift-test (Vercel project) 限定で、ops管理者アカウントを1件だけ作成するための
# 本人実行専用スクリプト。Claude(AI)はこのスクリプトを実行しません。
#
# 2026-10-02 修正: 当初案は `vercel env pull` でDATABASE_URLを取得する前提だったが、
# このプロジェクトのDATABASE_URLはVercel側でSecret型(書き込み専用)に設定されており、
# CLI/APIのどの経路からも平文を取得できない(アカウント所有者が実行しても同じ)。
# そのため同じ手順を繰り返しても必ず [SENSITIVE] で失敗する。
# 正しい取得元は Neon コンソール自身(Neonが発行する接続文字列の実体)であり、
# 「Show password」で表示させてこのスクリプトへ貼り付ける方式に変更した。
#
# 安全対策:
#   - 接続文字列はNeonコンソールから直接貼り付ける(`read -s`、非表示・画面に残さない)。
#     [SENSITIVE] のようなプレースホルダ文字列が貼り付けられた場合は直ちに停止する。
#   - 貼り付けられた接続文字列のホスト名が、2026-10-02にNeonコンソールで直接確認した
#     dent-shift-test-db の実際のエンドポイントID(ep-small-snow-b3srtm7d)と一致するかを
#     検証してから処理を進める。Neonのプロジェクト名(restless-art-55621985)とは別物であり、
#     ホスト名には含まれないため、プロジェクト名ではなくこのエンドポイントIDで照合する。
#     一致しなければ、Neonコンソールの dent-shift-test-db > main ブランチの接続パネルから
#     取り直すよう案内して停止する(同じ手順を無意味に繰り返させない)。
#   - パスワードは `read -s` で非表示入力する。
#     2026-10-03修正: zshの`read -p`は「プロンプト表示」ではなく「コプロセスから読む」の意味
#     (bashとは非互換)で、当初のコード(`read -r -s -p "..." VAR`)は対話実行時に必ず
#     `read: -p: no coprocess`で停止していた(「macOS動作確認済み」という前回の報告は誤りで、
#     対話的なzshでの実測検証をしていなかったため気づけなかった)。
#     正しいzsh構文は`read -r -s "VAR?プロンプト文字列"`で、ダミー入力を標準入力から渡す
#     非対話テスト(`echo "dummy" | zsh script.sh`)で全3箇所のread呼び出しを検証済み。
#   - 一時ファイル・一時ディレクトリは mktemp で作成し、スクリプト終了時(正常終了・エラー・
#     Ctrl-C中断のいずれでも)に trap で必ず削除する。
#   - 既存の .env やリポジトリ直下の node_modules/@prisma/client は変更しない。
#     一時ディレクトリへコピーしたプロジェクトファイルの中だけで prisma generate を実行する。
#   - 接続文字列・パスワードの値は、このスクリプトの出力に一切表示しない。
#
# 事前準備(実行前に手動で行う):
#   1. https://console.neon.tech/app/projects/restless-art-55621985/branches/br-green-morning-b3tfnlii
#      を開く(プロジェクト dent-shift-test-db、ブランチ main)
#   2. 左上の「Connect」ボタン→「Postgres database」タブ
#   3. Database: neondb / Role: neondb_owner になっていることを確認
#   4. 「Show password」をクリックし、表示された接続文字列(postgresql://... で始まる1行)
#      をコピーする
#
# 使い方:
#   cd /Users/masatokimura/Documents/dent-shift
#   zsh scripts/create-test-operator-safely.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 2026-10-03追加: このスクリプトを本来の場所(リポジトリのscripts/)以外から実行したり
# コピーして実行したりすると、$0のdirnameが崩れてREPO_ROOTが"/"やホームディレクトリ
# そのものに解決されてしまい、下のrsyncがシステム全体やホーム全体をコピーしてしまう
# 事故が実際に発生した(テスト実行時に判明)。rsyncを実行する前に、REPO_ROOTが
# "/"・ユーザーのホームディレクトリそのもの・空文字のいずれでもないこと、かつこの
# リポジトリ固有のマーカー(package.jsonの"name"フィールド)を含むことを必ず確認し、
# 満たさなければ即座に中断する。
if [ -z "$REPO_ROOT" ] || [ "$REPO_ROOT" = "/" ] || [ "$REPO_ROOT" = "$HOME" ]; then
  echo "エラー: コピー元ディレクトリの判定に失敗しました(REPO_ROOT='${REPO_ROOT}')。" >&2
  echo "        このスクリプトは必ずリポジトリ直下から次のように実行してください:" >&2
  echo "        cd /Users/masatokimura/Documents/dent-shift && zsh scripts/create-test-operator-safely.sh" >&2
  exit 1
fi
if ! grep -q '"name"[[:space:]]*:[[:space:]]*"dent-shift"' "$REPO_ROOT/package.json" 2>/dev/null; then
  echo "エラー: コピー元($REPO_ROOT)がdent-shiftリポジトリとして確認できませんでした。" >&2
  echo "        安全のため中断します。スクリプトをリポジトリ外へコピーせず、" >&2
  echo "        リポジトリ直下から直接実行してください。" >&2
  exit 1
fi

# 2026-10-02にNeonコンソールで直接確認した、dent-shift-test-db(main)の実際の
# エンドポイントID。接続文字列のホスト名にこの文字列が含まれるかで照合する。
EXPECTED_HOST_MARKER="ep-small-snow-b3srtm7d"

WORKDIR="$(mktemp -d /tmp/dentshift-ops-create.XXXXXX)"
cleanup() {
  local exit_code=$?
  rm -rf "$WORKDIR" 2>/dev/null || true
  unset DATABASE_URL OPERATOR_PASSWORD 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "==> 一時作業ディレクトリ: $WORKDIR (終了時に自動削除されます)"
echo ""
echo "==> 事前にNeonコンソールの以下のページで「Connect」→「Show password」から"
echo "    接続文字列(postgresql://... で始まる1行)をコピーしておいてください:"
echo "    https://console.neon.tech/app/projects/restless-art-55621985/branches/br-green-morning-b3tfnlii"
echo ""
read -r -s "DATABASE_URL?接続文字列を貼り付けてください(表示されません): "
echo ""

if [ -z "${DATABASE_URL:-}" ]; then
  echo "エラー: 接続文字列が空です。中断します。" >&2
  exit 1
fi

if echo "$DATABASE_URL" | grep -qi 'SENSITIVE'; then
  echo "エラー: 貼り付けられた値がプレースホルダ([SENSITIVE]等)のようです。" >&2
  echo "        Vercelの環境変数一覧ではなく、Neonコンソールの「Show password」から" >&2
  echo "        表示される実際の接続文字列をコピーしてください。中断します。" >&2
  exit 1
fi

if ! echo "$DATABASE_URL" | grep -q "$EXPECTED_HOST_MARKER"; then
  echo "エラー: 貼り付けられた接続文字列のホスト名が、既知の dent-shift-test-db の" >&2
  echo "        エンドポイント(${EXPECTED_HOST_MARKER})と一致しませんでした。" >&2
  echo "        別のNeonプロジェクト・別ブランチの接続文字列を貼り付けていないか、" >&2
  echo "        上記URLのページで再度「Show password」から取り直してご確認ください。" >&2
  echo "        安全のため、ここで中断します。" >&2
  exit 1
fi
export DATABASE_URL

echo "==> 接続先の検証に成功しました(dent-shift-test-db のエンドポイントと一致)。値そのものは表示しません。"

echo "==> プロジェクトを一時ディレクトリへコピーし、そこだけで Prisma Client を再生成します"
rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.next' \
  --exclude='.vercel' \
  "$REPO_ROOT"/ "$WORKDIR/project/"

(
  cd "$WORKDIR/project"
  npm install --no-audit --no-fund >/dev/null
  npx prisma generate --schema prisma/postgres/schema.prisma >/dev/null
)

echo ""
echo "==> 作成する管理者アカウントのメールアドレスを入力してください。"
read -r "OPERATOR_EMAIL?Email: "
if [ -z "$OPERATOR_EMAIL" ]; then
  echo "エラー: メールアドレスが空です。中断します。" >&2
  exit 1
fi

echo "==> パスワードを入力してください(8文字以上、画面には表示されません)。"
read -r -s "OPERATOR_PASSWORD?Password: "
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
echo "==> ログイン後の接続診断の取得はClaude側で行いますので、パスワードの共有は不要です。"
echo "==> 一時ファイル・一時ディレクトリ・環境変数はこの後の終了処理で自動的に削除されます。"
