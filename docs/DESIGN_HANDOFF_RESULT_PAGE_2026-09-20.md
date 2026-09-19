# DENT SHIFT — 診断結果画面 デザイン作り込み指示書

作成日: 2026-09-20。作業対象: **無料診断結果画面のみ**(`/diagnosis/result/[id]`)。他の画面(ダッシュボード・opsポータル等)は対象外。

宛先: この指示書を渡された別のAIコーディングエージェント(GPT/Codex等)。このリポジトリの既存実装に対する追加の見た目調整タスクである。

## 0. 最初に必ず読むもの

1. `docs/ui/DESIGN_SYSTEM.md` — ブランドカラー・ロゴ利用規則・表示原則。**この文書のルールを破らないこと**(ロゴの再デザイン禁止、独自カラー追加禁止、技術用語を前面に出さない、等)。
2. `public/brand/logo/README_使用ガイド.md` — 正式カラーコード・ロゴファイルの参照方法。
3. 本ドキュメントの1章(現状の実装ファイル)と2章(視覚的正本との差分)。

## 1. 現状の実装ファイル

- メインページ(サーバーコンポーネント): `src/app/diagnosis/result/[id]/page.tsx`
  - スタイルはすべてインラインstyleオブジェクト(Tailwind等は未導入)。`NAVY`/`BLUE`/`BG`/`BORDER`/`MUTED`という定数がファイル冒頭にあり、これがブランドカラーの正本(`public/brand/logo/README_使用ガイド.md`と一致させてある)。**新しい色を勝手に増やさず、この定数を使い回すか、ブランドガイドを確認したうえで定数を追加すること。**
- クリック計測用の薄いラッパー: `src/app/diagnosis/result/[id]/TrackedCtaLink.tsx`(触ってよいが、`navigator.sendBeacon`によるfire-and-forget計測ロジックは壊さないこと)
- 表示直前のデータ整形(view-model): `src/app/diagnosis/result/[id]/resultViewModel.ts`
  - **このファイルのロジックは変更しないこと。** 「取得不能値を0として表示しない」「サンプルデータを実績として見せない」等、このプロジェクト全体で徹底している事業ルールがここに実装されている。見た目の調整は`page.tsx`側の表示方法だけで行う。

## 2. 視覚的正本との差分

DESIGN_SYSTEM.mdにあるとおり、`design/reference/`配下の画像は「参考資料ではなくDENT SHIFT既存UIの視覚的正本」として扱うルールになっている。診断結果画面については`design/reference/`に該当画像が無いが、代わりに`Claude outputs/`配下に過去のデザイン検討時のスクリーンショットが残っており、これが診断結果画面の視覚的な目標に最も近い。特に以下を正本として参照すること。

- `Claude outputs/result_pc_cta.png` — PC版、2カラムレイアウト、右サイドバーにTOP3+診断ステータス+相談CTA
- `Claude outputs/result_mobile_cta.png` — モバイル版、1カラム
- `Claude outputs/15_result_pc_deduped.png`, `16_result_improvement_expanded.png` — 改善TOP3の展開状態など細部の参考

### 現状の実装で確認できている主な差分(2026-09-20、開発サーバーでの実機確認ベース)

1. **ヘッダー**: 正本は白背景・下線ボーダー付きの専用ヘッダーバー(横長ロゴを左寄せ、適切な余白)。現状の実装はロゴ画像をページ上部中央に単体で配置しているだけで、ヘッダーバー(背景・ボーダー・左寄せ)が無い。
2. **右サイドバーの構成**: 正本は右カラムに「今月やるべきこと(TOP3)」→「診断ステータス」→「この診断結果について相談する(AI集患スペシャリストに無料相談ボタン)」の3枚のカードが縦に並ぶ。現状の実装は右カラムにTOP3のみで、診断ステータスと相談CTAはメインカラム側に幅いっぱいのカードとして別途配置されている(構造自体は存在するので、配置場所を右サイドバーへ移すのが主なタスク)。
3. **全体の余白・カード間隔**: 正本はカード間の余白・カード内パディングが視覚的に統一されている。現状の実装と厳密なピクセル差分は本書執筆時点では未計測なので、**着手前に必ず自分で最新のスクリーンショットを取得し、正本画像と並べて比較すること**(3章の手順を参照)。
4. **総合スコアの円グラフ**: 正本・現状ともに同じ構造(左に円グラフ、右にcaveatテキスト)だが、サイズ・タイポグラフィのバランスに差がある可能性がある。実際の見た目を比較して判断すること。

上記はあくまで執筆時点の観察であり、正確な最新差分はあなた自身が3章の手順でスクリーンショットを取って確認すること。本書の差分リストを鵜呑みにしない。

## 3. 動作確認・差分確認の手順

このリポジトリにはUIコンポーネントのスナップショットテストが無い(jsdom未導入、`tests/`配下は純粋関数のみをテストしている)。そのため、見た目の変更は**必ず実際にブラウザで確認すること**。

```bash
cd /Users/masatokimura/Documents/dent-shift
npm run dev
```

**注意**: このマシンでは`localhost:3000`が過去に別プロジェクトのdevサーバーと衝突したことがある(IPv6の`::1`側に無関係なプロセスが居座っていたケースがあった)。`http://127.0.0.1:3000`のようにIPv4を明示してアクセスするか、事前に`lsof -nP -iTCP:3000 -sTCP:LISTEN`で誰が3000番を掴んでいるか確認すること。無関係なプロセスを`pkill`で巻き込んで停止させないよう、pkillのパターンは慎重に選ぶこと(例: `pkill -f "next dev"`は`vinext dev`のような無関係なコマンドにもマッチしてしまう)。

診断結果画面を表示するには、トップページ(`/`)→「無料でAI集患診断する」(`/diagnosis`)から、医院名・URL・メールアドレス・電話番号(070/080/090形式)を入力して送信し、診断完了まで待つ(モックプロバイダなので数秒で完了する)。

比較したら、テスト用に作成したClinic/Diagnosisレコードは以下のように削除してDBを汚さないこと。

```js
// node -e "..." で実行する例
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const clinic = await prisma.clinic.findFirst({ where: { url: 'https://your-test-url.jp' } });
if (clinic) {
  await prisma.aiObservation.deleteMany({ where: { clinicId: clinic.id } });
  await prisma.diagnosis.deleteMany({ where: { clinicId: clinic.id } });
  await prisma.clinic.delete({ where: { id: clinic.id } });
}
```

## 4. 厳守事項

- `resultViewModel.ts`・`src/domain/**`・`src/server/**`・Prisma schema・migrationは一切変更しないこと(表示ロジックではなく事業ロジック/データ層のため)。見た目の調整だけがこのタスクのスコープ。
- 新しい npm パッケージ(Tailwind、UIライブラリ等)を追加しないこと。既存のインラインstyleパターンを踏襲する。導入したい場合は先にユーザーへ確認する。
- ブランドロゴ(`public/brand/logo/`配下)の再生成・変形・色変更をしないこと。
- モバイル対応を崩さないこと(`Claude outputs/result_mobile_cta.png`が目標)。
- 「サンプル診断です」「一部の領域が未測定のため暫定スコアです」等の免責・注記テキストを削除・弱体化しないこと(法務・事業ルール上必須)。
- 作業完了時に必ず実行し、すべて成功させること:
  ```bash
  npm run test
  npx tsc --noEmit -p tsconfig.json
  npm run lint
  npm run build
  ```
- 完了後、変更前後のスクリーンショット(PC・モバイル各1枚以上)を添えて差分内容を簡潔に報告すること。
