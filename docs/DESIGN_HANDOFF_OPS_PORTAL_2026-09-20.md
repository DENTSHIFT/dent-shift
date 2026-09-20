# DENT SHIFT — 運営側ポータル UI調整 引き継ぎ指示書

作成日: 2026-09-20。作業対象: **運営側ポータルのみ**(`/ops/login`、`/ops/dashboard`)。医院向け画面(診断結果・ダッシュボード等)は対象外。

宛先: この指示書を渡された別のAIコーディングエージェント(GPT/Codex等)。このリポジトリの既存実装に対する見た目調整タスクである。

これまで診断結果画面(`docs/DESIGN_HANDOFF_RESULT_PAGE_2026-09-20.md`、コミット`0e25313`)、ダッシュボード画面(`docs/DESIGN_HANDOFF_DASHBOARD_2026-09-20.md`、コミット`6e850af`)で同種のUI調整を実施済み。同じ進め方・同じ制約方針を踏襲すること。

## 0. 最初に必ず確認するもの

1. `docs/ui/DESIGN_SYSTEM.md` — ブランドカラー・ロゴ利用規則・表示原則
2. `public/brand/logo/README_使用ガイド.md` — 正式カラーコード
3. **本書1章(正本画像が存在しないことの意味)を読んでから作業を開始すること**

## 1. 重要事項: このタスクには視覚的正本(デザイン画像)が存在しない

`design/reference/`配下には`dashboard/`(医院向け)と`lp/`しか無く、運営側ポータル専用のデザイン画像は無い。したがって、**このタスクは「既存の正本画像に寄せる」作業ではなく、「既に見た目を整えた医院向けダッシュボード・診断結果画面と統一感のあるデザインシステムを、社内ツールとして適切な情報密度で運営側ポータルにも適用する」作業である。**

方針:
- 配色・タイポグラフィ・カードの角丸/余白の感覚は、`src/app/dashboard/page.tsx`・`src/app/dashboard/dashboard.module.css`・`src/app/diagnosis/result/[id]/page.tsx`で確立済みのスタイルをそのまま踏襲すること(`NAVY`/`BLUE`/`BG`/`BORDER`/`MUTED`の値を流用)。
- ただし運営側は社内オペレーター専用ツールであり、医院向け画面ほど装飾的にする必要はない。情報密度を高く、実務で使いやすいテーブル/リスト中心のレイアウトでよい(一般的な社内管理画面の見た目を目指す)。
- 独自のカラーパレットやデザイン言語を新たに作らないこと。

## 2. 現状の実装ファイル

- ログイン画面: `src/app/ops/login/page.tsx`、`src/app/ops/login/OpsLoginForm.tsx`
  現状すでに医院向けログインフォームと同系統のスタイル(インラインstyle、`Field`ヘルパー)で実装済み。大きな変更は不要、必要なら微調整程度。
- ダッシュボード(医院一覧、クロステナント参照): `src/app/ops/dashboard/page.tsx`
  **現状はスタイル未整備の素のHTML tableのみ**(`main`要素に最小限のインラインstyleがあるだけで、ヘッダーバー・サイドバー・カード等の要素が一切無い)。今回のタスクの主な対象はここ。
- 認証ロジック: `src/server/auth/operatorSession.ts`、`src/server/auth/requireOperator.ts`(変更しないこと)
- 監査ログ記録: `src/server/db/auditLogRepository.ts`(変更しないこと。`recordAuditLog()`の呼び出し自体・呼び出しタイミングを変更・削除しないこと)

## 3. 見た目の調整方針(具体案、必須ではなく参考)

- ページ全体を`src/app/dashboard/page.tsx`と同様のヘッダーバー(白背景・下線ボーダー、DENT SHIFTロゴ)で囲む。ただし「運営側」であることが一目でわかるよう、ヘッダー内に**「管理者用」**というラベルを付けること(医院向け画面と誤認させないため重要。バッジやテキストで、ロゴの隣など目立つ位置に配置する)。`/ops/login`のページタイトル・見出しについても、「運営側ログイン」ではなく**「管理者用ログイン」**のように「管理者用」という語で統一すること。
- 医院一覧のtableをカードで囲み、行の視認性を上げる(ストライプ、hover等は任意)。
- ログイン中のOperator情報(メールアドレス・ロール)を右上等に表示する現状の挙動は維持すること。
- ログアウト導線が現状無い(`/api/ops/auth/logout`は実装済みだがUIボタンが無い)。**ログアウトボタンをヘッダーに追加してよい**(医院向け`LogoutButton`コンポーネントと同じ要領で新規作成する。`src/app/dashboard/LogoutButton.tsx`を参考にしつつ、呼び出し先を`/api/ops/auth/logout`・遷移先を`/ops/login`に変える新しいコンポーネントとして作ること。既存の医院向け`LogoutButton.tsx`自体は変更しないこと)。

## 4. 厳守事項

- `src/server/**`・`src/domain/**`・Prisma schema・migrationは一切変更しないこと。
- `recordAuditLog()`の呼び出し(ログイン時・医院一覧参照時)を削除・弱体化しないこと。運営側のクロステナント参照は必ず監査ログを伴うという設計原則(`docs/SECURITY.md`)を壊さないこと。
- 表示するデータ(医院名・URL・診断回数・会員数・契約状態・登録日)以外の**架空の統計・グラフ・KPIを新たに追加しないこと**(診断結果画面・ダッシュボードのときと同じ「データ捏造禁止」の原則。運営側だからといって適当な数値を足してよいわけではない)。
- 新しいnpmパッケージを追加しないこと。
- ブランドロゴの再生成・変形・色変更をしないこと。
- モバイル対応は必須ではない(社内ツールのため)が、明らかに崩れる場合は最低限の対応をすること。

## 5. 動作確認の手順

```bash
cd /Users/masatokimura/Documents/dent-shift
npm run dev
```

**注意**: `localhost:3000`が過去に別プロジェクトのdevサーバーと衝突したことがある。`http://127.0.0.1:3000`のようにIPv4を明示してアクセスするか、事前に`lsof -nP -iTCP:3000 -sTCP:LISTEN`で確認すること。`pkill`で無関係なプロセスを巻き込まないよう注意。

Operatorアカウントは自己サインアップが無いため、以下で作成する(確認後は必ず削除すること)。

```bash
OPERATOR_PASSWORD=xxxxxxxx npx tsx --conditions=react-server scripts/create-operator.ts --email=your-review@example.com --role=admin
```

確認後の削除は以下の通り(Operator削除前にAuditLog・OperatorSessionを先に削除すること。外部キー制約があるため)。

```js
// node -e "..." で実行する例
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const op = await prisma.operator.findUnique({ where: { email: 'your-review@example.com' } });
if (op) {
  await prisma.auditLog.deleteMany({ where: { operatorId: op.id } });
  await prisma.operatorSession.deleteMany({ where: { operatorId: op.id } });
  await prisma.operator.delete({ where: { id: op.id } });
}
```

医院一覧に表示するデータ自体は既存のClinicレコードをそのまま使ってよい(新規作成不要)。

## 6. 完了報告に含めること

- 作業完了時に必ず以下をすべて成功させること:
  ```bash
  npm run test
  npx tsc --noEmit -p tsconfig.json
  npm run lint
  npm run build
  ```
- 変更前後のスクリーンショット(`/ops/dashboard`、可能なら`/ops/login`も)
- 変更ファイル一覧・差分要約
- `recordAuditLog()`の呼び出し箇所が変更されていないことの明示的な確認
- 架空の統計・KPIを追加していないことの明示的な確認
- 作成したOperatorアカウント(および付随するAuditLog/OperatorSession)を削除したことの確認
