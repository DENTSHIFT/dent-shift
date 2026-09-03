# DENT SHIFT — P0 Step3〜4: 無料診断 vertical slice + 認証・無料会員

IMPLEMENTATION_PLAN.md の Step3(無料60秒AI集患診断のvertical slice)実装。
医院URL入力 → clinic作成 → mock providerによる分析 → 6領域スコア → 競合3院(mock) →
質問別勝敗 → 改善TOP3 → 診断結果画面、までを一通り動かせる状態にしてあります。

## 重要な制約(必ず読んでください)

このコードは開発サンドボックス環境(npmレジストリへのアクセスが遮断されている)で作成したため、
**`npm install` はまだ一度も実行できていません。** ドメインロジック(`src/domain/diagnosis/scoring.ts`)
だけは依存パッケージなしで動くため、Node単体で動作確認済みです(6領域合算・取得不能値の非0扱い・
配点超過エラー・領域欠落エラーを確認)。それ以外(Next.js/Prisma/UI一式)は型・構文レベルで注意深く
書きましたが、実行確認はまだできていません。ローカル環境かCI(GitHub Actions等)で最初に
`npm install` を行い、下記の手順で動作確認してください。

## セットアップ

```bash
npm install
cp .env.example .env
npx prisma migrate dev --name init
npm run dev
```

`http://localhost:3000` を開き、「無料でAI集患診断する」から医院名・URL・メールアドレスを入力すると、
mock providerによる診断結果画面(`/diagnosis/result/[id]`)まで到達できます。

## テスト

```bash
npm test
```

`tests/unit/scoring.test.ts` がドメイン層のスコア集計ロジックを検証します。

## Step4: 認証・無料会員

`/signup`(医院名+URLで新規登録、または診断結果画面の「無料会員登録する」からclinicIdを引き継いで登録)、
`/login`、`/dashboard`(その医院の過去診断一覧、`contact.clinicId`でスコープしたテナント分離クエリ)を追加。
パスワードはNode標準の`crypto.scrypt`でハッシュ化(bcrypt等の追加依存なし)、セッションはJWTではなく
DBに保存する不透明トークン+httpOnly cookie方式(`ds_session`)。電話番号は引き続き一切要求しない。

## このsliceでやっていないこと(意図的にスコープ外)

- 実際のChatGPT/Gemini/GA4/Search Console/GBPへの接続(すべてmock providerのまま)
- 課金・アンバサダー・スタッフ複数人招待等(IMPLEMENTATION_PLAN.mdのStep5以降)
- Postgresへの切り替え(開発中はSQLite。ARCHITECTURE.md参照)

## 事業ルールの実装上のポイント

- `domain/diagnosis/scoring.ts`: 取得不能な領域を0点として扱わず、`status: "unavailable"` として
  合算から除外し、`totalStatus` を `"partial"` にする(引き継ぎ書3章-11, -12)。
- `server/providers/*/mock*.ts`: すべての結果に `dataSource: "mock"` を明示し、UI側でも
  disclaimerバナー・「(推定)」表示として可視化している(サンプルを実績として見せない)。
- `server/services/runFreeDiagnosis.ts`: 患者個人情報(氏名・電話番号等)を扱うフィールドを
  そもそも持たない。電話番号入力欄もUIに存在しない。
