# DENT SHIFT 本番環境構築ガイド(準備段階)

作成日: 2026-09-22。この文書はコード変更・外部サービスへの書き込みを一切行わず、
ローカルの設定調査のみに基づいて作成した。実際のVercel/Stripe/Resend/Twilio操作は
別途ユーザー承認後に行う。

## 1. production で必要な環境変数の完全一覧

`.env.example` および `src/server/config/*.ts` の各 `resolve*ConfigFromProcessEnv()`
を突き合わせて確認した(コード側が読む変数と `.env.example` の記載に不一致はなかった)。

秘密値そのものは一切含めない。「必須/任意」は各providerを有効化する場合の要否。

### 必須(production公開に絶対に必要)

| 変数名 | 用途 | test環境での状態 | production要否 |
|---|---|---|---|
| `DATABASE_URL` | DB接続 | test用Postgres | **新規のproduction専用Postgresを指す値に置き換え**(test DBと共有禁止) |
| `APP_BASE_URL` | Stripe Checkout success/cancel URL、メール内リンク等の基準URL | `https://test.dentshift.jp`(想定、要現況確認) | `https://dentshift.jp` |
| `BILLING_PROVIDER` | 決済プロバイダー切替 | `stripe` | `stripe` |
| `STRIPE_SECRET_KEY` | Stripe API | test鍵(`sk_test_...`) | **live鍵(`sk_live_...`)を新規取得**、test値の流用禁止 |
| `STRIPE_WEBHOOK_SECRET` | Webhook署名検証 | test用 | **live Webhook作成時に新規発行**される値 |
| `STRIPE_PRICE_ID_LIGHT` | ライトプラン | test Price ID | **live Priceを新規作成** |
| `STRIPE_PRICE_ID_STANDARD` | スタンダードプラン | test Price ID | 同上 |
| `STRIPE_PRICE_ID_PREMIUM` | プレミアムプラン | test Price ID | 同上 |
| `STRIPE_PRICE_ID_INSTRUCTION_PDF` | 制作会社向け修正指示書(¥3,300) | test Price ID | 同上 |
| `STRIPE_PRICE_ID_INVITE_MONITOR` | 1円招待モニター | test Price ID | 同上(¥1、通常Priceとは別) |
| `STRIPE_TAX_RATE_ID` | 消費税率 | test用 | **live Tax Rateを新規作成** |
| `ARTIFACT_PASSWORD_ENC_KEY` | 生成PDFパスワードの可逆暗号化鍵(32byte hex) | test用固定値 | **production専用に新規生成**(環境ごとに別値、コード側コメントで明記済み) |
| `RESULT_EMAIL_PROVIDER` | メール送信プロバイダー | `resend` | `resend` |
| `RESEND_API_KEY` | Resend API | test用 | **production用に新規発行を推奨**(同一キー流用も技術的には可能だが分離推奨) |
| `RESULT_EMAIL_FROM` | 送信元アドレス | `results@dent-shift.mcollection-japan.jp` | `results@dentshift.jp` 等、**`dentshift.jp` ドメインの認証済みアドレス**に変更必須 |
| `AI_MEASUREMENT_PROVIDER` | AI計測provider | `openai` | `openai`(据え置き想定) |
| `OPENAI_API_KEY` | OpenAI API | 設定済み | 同一鍵の流用可(利用量次第で分離検討) |
| `OPENAI_AI_MEASUREMENT_MODEL` | 使用モデル名 | 設定済み | 同一値でよい |
| `NEXT_PUBLIC_SPECIALIST_BOOKING_URL` | TimeRex予約CTA | 設定済み | 本番用ページURLへ変更が必要か要確認(同じTimeRexページを使うなら変更不要) |
| `NEXT_PUBLIC_SUPPORT_PHONE_NUMBER` | 電話問い合わせCTA | 設定済み | 据え置き想定 |

### 必須(SMS認証を有効にする場合)

| 変数名 | test環境 | production |
|---|---|---|
| `SMS_PROVIDER` | `twilio-verify` | `twilio-verify`(据え置き想定) |
| `TWILIO_ACCOUNT_SID` | trialアカウント | **production利用のためアカウントのアップグレードが必要**(下記7章) |
| `TWILIO_AUTH_TOKEN` | 同上 | 同上 |
| `TWILIO_VERIFY_SERVICE_SID` | 同上 | 同一Verify Serviceを流用できるか、アップグレード後に要確認 |

### 必須(Vercel Cronを保護する場合。productionでは強く推奨)

| 変数名 | test環境 | production |
|---|---|---|
| `CRON_SECRET` | **未設定**(認証スキップ状態) | **必ず設定**。未設定だと`/api/internal/salesforce/retry`が無認証で叩ける状態になる |

### 現時点でdisabledのまま(今回のスコープ外、9/24以降に判断)

| 変数名 | 状態 |
|---|---|
| `SALESFORCE_PROVIDER`(+CLIENT_ID/SECRET/LOGIN_URL) | disabled維持。Salesforceは今回のフェーズで触らない |
| `LINE_WORKS_PROVIDER`(+関連6項目) | disabled維持。API仕様未確定 |
| `TIMEREX_WEBHOOK_SECRET` | 暫定実装のため、production投入は9/24のimmedio確認後に判断 |

### production環境変数として設定不要(ローカル/手動smoke test専用)

- `SMOKE_CLINIC_NAME` / `SMOKE_CLINIC_URL`(`scripts/openai-measurement-smoke.ts`専用)

## 2. test / production 差分一覧(要点)

| 項目 | test | production |
|---|---|---|
| Vercelプロジェクト | `dent-shift-test`(Git連携済み) | `dent-shift-production`(既存だが**Git未連携**、要確認) |
| ドメイン | `test.dentshift.jp`(旧`test.dent-shift.mcollection-japan.jp`から移行済み、本書き換えで反映) | `dentshift.jp` |
| DB | Vercel Marketplace管理型Postgres(test専用) | **新規に別DBを作成**(共有禁止、`docs/TEST_DEPLOYMENT.md`にも明記済みの安全ルール) |
| Stripe | Sandboxのみ(test mode) | live mode、**Price/Webhook/Tax Rateすべて新規作成**、test値の流用不可 |
| Resend送信元 | `dent-shift.mcollection-japan.jp`のサブドメイン | `dentshift.jp`ドメインでの送信ドメイン認証が必要 |
| Twilio | trialアカウント(未検証番号への送信制限あり) | production利用条件を満たすアップグレードが必要 |
| `CRON_SECRET` | 未設定(ローカル開発同様に認証スキップ) | 必須設定 |
| `ARTIFACT_PASSWORD_ENC_KEY` | test専用固定値 | production専用に新規生成 |

## 3. production公開前チェックリスト

### 3-1. DB / Migration
- [ ] production専用のPostgres DBを新規作成(Vercel Marketplace経由、test DBとは別インスタンス)
- [ ] `DATABASE_URL`をVercel production環境変数へ設定
- [ ] `npx prisma migrate deploy --schema prisma/postgres/schema.prisma` で全12件のmigrationが適用されることを確認(ローカルでは`prisma validate`のみ実施済み、実DB接続確認は未実施)
- [ ] production DBへ**test用データが混入していない**(空DBから開始)ことを確認

### 3-2. Build
- [ ] `npm test` 全件成功(現状855件成功、直近コミット`6fe056f`基準)
- [ ] `npm run lint` 成功
- [ ] `npm run build` 成功
- [ ] `DATABASE_URL="postgresql://..." npm run prisma:validate:postgres` 成功(スキーマ検証)
- [ ] `DATABASE_URL="postgresql://..." npm run build:vercel` のドライラン(実DB接続下で)

### 3-3. 環境変数
- [ ] 上記1章の「必須」項目がすべてVercel production環境変数に設定済み
- [ ] `NEXT_PUBLIC_`接頭辞が付いた変数以外(APIキー等)はサーバー変数としてのみ登録されている
- [ ] `.env`がGitに含まれていないことを再確認(既存の`.gitignore`ルールで担保済み)

### 3-4. Webhook / 外部連携
- [ ] Stripe live Webhook endpointを`https://dentshift.jp/api/billing/webhook`へ新規作成
- [ ] 必要6イベント(`checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`)がlisten対象
- [ ] Webhook Signing SecretをVercel production環境変数へ反映
- [ ] テストイベント送信 → 200 OK確認(test環境で先日実施した手順と同じ)

### 3-5. ドメイン
- [ ] `dentshift.jp`をVercel `dent-shift-production`プロジェクトへ割当
- [ ] DNS(XServer)側でproduction用レコードを設定
- [ ] `APP_BASE_URL=https://dentshift.jp`に統一されていることをVercel環境変数で確認

### 3-6. エラーロギング / 可観測性
- [ ] Vercelのproductionデプロイでランタイムログが確認できること(現状はVercelの標準ログのみ、専用APM等は未導入 — 今回のスコープでは追加提案しない)
- [ ] Webhook処理失敗時のログ出力(既存の`console.error`ベース実装で足りるか、公開後に様子を見る)

### 3-7. ロールバック方法
- [ ] Vercelの「Instant Rollback」機能で直前のデプロイへ即時戻せることを確認(Vercelの標準機能、追加設定不要)
- [ ] DB migrationは前方互換(今回の全migrationは列追加のみで破壊的変更なし)であることを確認済み — ロールバック時にmigration巻き戻しは不要な設計

## 4. スモークテスト計画

### 4-1. 無課金で確認できる項目
- LPと`/plans`の表示(価格・機能比較)
- 無料AI診断フォーム送信 → 結果表示 → メール送信(Resend production環境)
- 会員登録 → SMS認証(Twilio production環境、検証済み番号で) → メール確認
- ダッシュボード表示(プラン未選択状態)
- `/invite/{code}`ページの表示(実際に決済ボタンを押さない)
- Stripe Webhookの疎通確認(test event送信、実課金なし)
- 404/エラーページの表示

### 4-2. 実課金が必要な項目(最小限に絞って実施)
- ライトまたはスタンダードプランの実契約 → 7日間トライアルの表示確認 → **トライアル期間内に解約**して実際の引き落としを避ける
- 制作会社向け修正指示書(¥3,300)の実購入 → PDF生成 → ダウンロード確認(実費発生、1回のみ)
- 1円招待モニターの実契約(¥1、実費は最小)

**実施方針**: 実課金を伴うテストは本番リリース直前に必要最小限(各1回)だけ行い、
テスト後は速やかに解約する。Stripeダッシュボードで返金対応も可能。

## 5. production設定不足の最終一覧(要点のみ、詳細は1章参照)

1. production用Postgres DB(未作成)
2. Stripe live mode一式(APIキー・Price×5・Webhook・Tax Rate、すべて未作成)
3. `dentshift.jp`ドメインのVercel/DNS設定(未割当)
4. Resendの`dentshift.jp`送信ドメイン認証(未実施)
5. Twilioのproduction利用条件(trialアカウントのまま、要アップグレード確認)
6. `CRON_SECRET`・`ARTIFACT_PASSWORD_ENC_KEY`のproduction専用値(未生成)
7. Vercel `dent-shift-production`プロジェクトのGit連携状況(要再確認)
