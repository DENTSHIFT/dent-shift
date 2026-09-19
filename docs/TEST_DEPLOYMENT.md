# DENT SHIFT テスト環境公開手順

## 構成

- Web: Vercel (Next.js)
- Database: Vercel Marketplace経由の管理型PostgreSQL
- DNS: XServer (`mcollection-japan.jp`)
- Test URL: `https://test.dent-shift.mcollection-japan.jp`
- Email: Resend (`results@dent-shift.mcollection-japan.jp`)

ローカル開発は従来どおり `prisma/schema.prisma` とSQLiteを使う。Vercelだけ
`prisma/postgres/schema.prisma` と、その配下のPostgreSQL専用migrationを使う。

## 重要な安全ルール

1. `.env` とAPIキーをGitへ追加しない。
2. VercelのProduction buildでは、接続済みのテストDBに対して
   `prisma migrate deploy` で未適用migrationだけを反映する。ローカルとPreview buildでは実行しない。
3. 現在のVercelプロジェクトはテスト専用。実運用を開始するときは別プロジェクト・別DBを作り、
   テストDBの `DATABASE_URL` を共有しない。
4. `APP_BASE_URL` は公開確認後に `https://test.dent-shift.mcollection-japan.jp` へ設定する。
5. OpenAI/ResendのキーはVercelのEnvironment Variablesへサーバー変数として登録し、
   `NEXT_PUBLIC_` 接頭辞を付けない。

## Vercelへ設定する環境変数

```text
DATABASE_URL
AI_MEASUREMENT_PROVIDER=openai
OPENAI_API_KEY
OPENAI_AI_MEASUREMENT_MODEL
RESULT_EMAIL_PROVIDER=resend
RESEND_API_KEY
RESULT_EMAIL_FROM=DENT SHIFT <results@dent-shift.mcollection-japan.jp>
APP_BASE_URL=https://test.dent-shift.mcollection-japan.jp
NEXT_PUBLIC_SPECIALIST_BOOKING_URL=https://timerex.net/s/mstkmr.0502_719c/f44c6446
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ID_LIGHT
STRIPE_PRICE_ID_STANDARD
STRIPE_PRICE_ID_PREMIUM
STRIPE_TAX_RATE_ID
```

このVercelプロジェクトではStripeサンドボックスのみを使用する。上記の秘密値は
VercelのEnvironment Variablesにだけ登録し、文書・画面・ログへ値を出さない。
本番用Stripeキーや本番用Webhookはこのテストプロジェクトへ登録しない。

Stripe連携を一時停止する場合は`BILLING_PROVIDER=disabled`へ戻す。この状態でも
`/plans`の機能比較は表示されるが、カード入力・請求は開始されない。

## Stripeサンドボックス確認結果（2026-09-11）

- ライト（14,800円/月・税込10%）で検証専用サブスクリプションを作成した。
- 支払い失敗後、Stripeの`past_due`とDENT SHIFTの「お支払い確認中」が同期した。
- 即時解約後、Stripeの`canceled`とDENT SHIFTの「解約済み」が同期した。
- 確認にはStripe Test Clockと支払い失敗用テストカードを使用し、実請求は発生していない。
- 検証完了後、専用Test Clockを終了した。既存のスタンダード・テスト契約は変更していない。

## 公開前チェック

```bash
npm test
npm run build
DATABASE_URL="postgresql://..." npm run prisma:validate:postgres
DATABASE_URL="postgresql://..." npm run build:vercel
```

初回のVercel Production公開時に、未適用のPostgreSQL migrationが自動で反映される。
その後Vercelの割当先を確認し、XServer DNSへ `test` のCNAMEを追加する。
