# DENT SHIFT テスト環境公開手順

**2026-09-22更新**: Vercelプロジェクト`dent-shift-test`のGit連携先を
`test.dentshift.jp`へ移行済み。旧ドメイン`test.dent-shift.mcollection-japan.jp`
向けのStripe Webhookエンドポイントは無効化済み(履歴保持のため削除はしていない)。
本ドキュメントは現状に合わせて更新した。production向けの手順は
`docs/PRODUCTION_DEPLOYMENT.md`を参照(test環境とは別プロジェクト・別DBで構築する)。

## 構成

- Web: Vercel (Next.js) — プロジェクト名 `dent-shift-test`
- Database: Vercel Marketplace経由の管理型PostgreSQL(test専用インスタンス)
- DNS: XServer (`mcollection-japan.jp`) ※`dentshift.jp`は別ドメイン
- Test URL: `https://test.dentshift.jp`
- Email: Resend (`results@dent-shift.mcollection-japan.jp`、test用送信元のまま)

ローカル開発は従来どおり `prisma/schema.prisma` とSQLiteを使う。Vercelだけ
`prisma/postgres/schema.prisma` と、その配下のPostgreSQL専用migrationを使う。

## 重要な安全ルール

1. `.env` とAPIキーをGitへ追加しない。
2. VercelのProduction buildでは、接続済みのテストDBに対して
   `prisma migrate deploy` で未適用migrationだけを反映する。ローカルとPreview buildでは実行しない。
3. 現在のVercelプロジェクトはテスト専用。実運用を開始するときは別プロジェクト・別DBを作り、
   テストDBの `DATABASE_URL` を共有しない。
4. `APP_BASE_URL` は `https://test.dentshift.jp` に設定する(2026-09-22時点)。
5. OpenAI/ResendのキーはVercelのEnvironment Variablesへサーバー変数として登録し、
   `NEXT_PUBLIC_` 接頭辞を付けない。

## Vercelへ設定する環境変数

2026-09-22時点の完全な一覧(変数名のみ。値は記載しない)。完全な用途説明は
`docs/PRODUCTION_DEPLOYMENT.md`の1章を参照(production用の要否も含めた一覧はそちら)。

```text
DATABASE_URL
AI_MEASUREMENT_PROVIDER=openai
OPENAI_API_KEY
OPENAI_AI_MEASUREMENT_MODEL
RESULT_EMAIL_PROVIDER=resend
RESEND_API_KEY
RESULT_EMAIL_FROM=DENT SHIFT <results@dent-shift.mcollection-japan.jp>
APP_BASE_URL=https://test.dentshift.jp
NEXT_PUBLIC_SPECIALIST_BOOKING_URL=https://timerex.net/s/mstkmr.0502_719c/f44c6446
NEXT_PUBLIC_SUPPORT_PHONE_NUMBER
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ID_LIGHT
STRIPE_PRICE_ID_STANDARD
STRIPE_PRICE_ID_PREMIUM
STRIPE_TAX_RATE_ID
STRIPE_PRICE_ID_INSTRUCTION_PDF
STRIPE_PRICE_ID_INVITE_MONITOR
ARTIFACT_PASSWORD_ENC_KEY
SMS_PROVIDER=twilio-verify
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_VERIFY_SERVICE_SID
```

以下は本書作成時点でVercel `dent-shift-test` の環境変数には含めていない
(ローカル`.env`では動作確認のためSalesforceのみ有効化しているが、Vercelの
テスト環境へは未反映):
`SALESFORCE_PROVIDER`系、`LINE_WORKS_PROVIDER`系、`TIMEREX_WEBHOOK_SECRET`、`CRON_SECRET`。
Salesforceの扱いは別タスクとして9/24以降に判断する。

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

Vercel Production公開のたびに、未適用のPostgreSQL migrationが自動で反映される
(`npm run build:vercel`が`VERCEL_ENV=production`時のみ`prisma migrate deploy`を実行する)。
`test.dentshift.jp`へのドメイン割当・DNS設定は完了済み(2026-09-22時点)。
