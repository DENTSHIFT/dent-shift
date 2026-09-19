# DENT SHIFT — P0: 無料診断 + OpenAI検索API計測 + 認証

IMPLEMENTATION_PLAN.md の Step3(無料60秒AI集患診断のvertical slice)を中心に実装。
医院URL入力 → clinic作成 → 6領域スコア → 競合3院(参考データ) →
質問別のAI表示状況 → 改善TOP3 → 診断結果画面、までを一通り動かせる状態です。
設定により、対象3質問へOpenAI Responses API + Web Searchの実測を重ねられます。

## 現在の確認状況

依存パッケージの導入、単体・SQLite結合テスト、本番ビルド、OpenAI Web Search APIの
手動実測までMac上で確認済みです。APIキーはサーバー側の環境変数だけで扱います。

## セットアップ

```bash
npm install
cp .env.example .env
npx prisma migrate dev --name init
npm run dev
```

APIを使わず参考データだけで動かす場合は、`.env`で
`AI_MEASUREMENT_PROVIDER=mock`を明示してください。OpenAI検索API計測を使う場合は
`AI_MEASUREMENT_PROVIDER=openai`とし、APIキーとモデルをサーバー側の環境変数へ設定します。

`http://localhost:3000` を開き、「無料でAI集患診断する」から医院名・URL・メールアドレス・医院代表電話番号を入力すると、
診断結果画面(`/diagnosis/result/[id]`)まで到達できます。
未ログイン時は、既存Clinicとの完全URL一致・公式サイトドメイン一致・医院名一致を診断開始前に
候補として検出します。候補は勝手に統合せず、ログインまたは別データとして続行する選択を表示します。

## テスト

```bash
npm test
```

単体テストとSQLite結合テストをまとめて実行します。APIへの実通信はこのコマンドでは行いません。

## テスト環境の公開

公開テスト環境はVercel + 管理型PostgreSQLを使用し、
`https://test.dent-shift.mcollection-japan.jp` を割り当てます。ローカルSQLiteの
スキーマとmigrationは維持し、Vercelでは`prisma/postgres/schema.prisma`と
PostgreSQL専用migrationを使います。VercelのProduction build時だけ、
`prisma migrate deploy`で未適用migrationを反映します。
詳細は`docs/TEST_DEPLOYMENT.md`を参照してください。

## Step4: 認証・無料会員

`/signup`(医院名+URLで新規登録)、
`/login`、`/dashboard`を追加。ダッシュボードでは、その医院の最新診断から総合スコア・6領域・
患者質問ごとのAI表示状況・改善TOP3・競合候補・診断履歴を表示します。商圏順位やAI流入〜予約の
未連携データは0や推定値で補わず「未連携」と表示します。取得は`contact.clinicId`でスコープした
テナント分離クエリを入口にし、他医院の診断が混ざらないようにしています。
パスワードはNode標準の`crypto.scrypt`でハッシュ化(bcrypt等の追加依存なし)、セッションはJWTではなく
DBに保存する不透明トークン+httpOnly cookie方式(`ds_session`)。認証自体はメール+パスワードで行い、
無料診断では医院代表電話番号を必須入力として医院情報へ保存します。
ログイン中に再診断画面を開くと登録済みの医院名・公式URL・メール・医院代表電話番号を自動入力し、結果を同じ医院の
診断履歴へ追加します。保存先の医院IDはリクエスト値ではなくサーバー側のセッションから解決します。
自院の診断結果を表示している場合に限り、結果画面からダッシュボードへ戻る導線を表示します。

診断結果画面には、希望者だけがTimeRexへ進む「スペシャリストに相談する」導線があります。
所要時間の45分は別のバッジで示します。TimeRex側でも予約連絡用の番号を必須入力とします。

## 診断結果メール

診断完了後、入力された医院代表メールアドレスへ、診断ページのURL・総合結果・改善項目を
送る処理を実装しています。送信状態は診断ごとに保存し、結果画面へ「送信済み／送信できなかった」
を表示します。メール送信の障害で、保存済みの診断や結果画面を失敗扱いにはしません。
送信先は患者情報ではなく医院の代表連絡先として`Clinic.contactEmail`へ保存します。

安全な既定値は`RESULT_EMAIL_PROVIDER=disabled`です。公開テスト環境ではResendを採用し、
`resend`へ変更したうえで`RESEND_API_KEY`、`RESULT_EMAIL_FROM`、
`APP_BASE_URL`を設定します。APIキーはサーバー側だけで扱い、画面やエラーログへ出しません。
送信元ドメインの確認と公開環境での送信成功まで確認済みです。

## Step5: プラン比較・契約・決済の土台

`/plans`にライト・スタンダード・プレミアムの機能比較を追加しています。月額基準価格は
ライト14,800円、スタンダード39,800円、プレミアム79,800円（いずれも税込）で確定し、
`src/domain/billing/planPricing.ts`を公開表示の唯一の情報源にしています。
契約・入金の保存先、医院単位の取得、契約状態の安全な遷移、Stripe Checkout作成口、
署名検証付きWebhookと再送時の二重処理防止まで実装済みです。ダッシュボードでは自院の
契約状態だけを日本語で確認できます。公開テスト環境ではStripeサンドボックスのPrice ID、
内税10%のTax Rate、署名検証付きWebhookを設定しています。本番決済は有効にせず、
テストカードによる確認が完了するまでは実請求を開始しません。

## このsliceでやっていないこと(意図的にスコープ外)

- Gemini / GA4 / Search Console / GBPへの実接続
- 消費者向けChatGPT画面そのものの計測(OpenAI Web Search API計測とは別物)
- Stripe決済の本番有効化、アンバサダー、スタッフ複数人招待等
- Postgresへの切り替え(開発中はSQLite。ARCHITECTURE.md参照)

## 事業ルールの実装上のポイント

- `domain/diagnosis/scoring.ts`: 取得不能な領域を0点として扱わず、`status: "unavailable"` として
  合算から除外し、`totalStatus` を `"partial"` にする(引き継ぎ書3章-11, -12)。
- `server/providers/*/mock*.ts`: 参考データには `dataSource: "mock"` を明示し、UIでも実測と区別する。
- OpenAI検索API計測は`measurementStatus: "measured"`、未実測の参考データは`"reference"`として
  分離し、取得失敗を0点や参考データへの黙示的な置き換えとして扱わない。
- `server/services/runFreeDiagnosis.ts`: 患者個人情報(氏名・電話番号等)は扱わない。診断で扱う
  電話番号は医院の代表連絡先であり、患者情報とは明確に分離する。
