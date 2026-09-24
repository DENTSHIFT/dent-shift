# DENT SHIFT 障害対応ランブック

作成日: 2026-09-24。秘密情報（APIキー・トークン等の値）は一切含めない。
環境変数は名前のみ記載し、実際の値はVercelダッシュボード（Settings → Environment Variables）で確認する。

対象範囲: 「無料AI診断 → メール確認/結果 → TimeRex無料相談」の主要導線。

## 1. 障害調査の入口（opsツール）

コード変更やDB直接操作の前に、まずこれらのops画面で状況を確認する。
（`/ops/login`からログイン。既存Operatorアカウントが必要）

| 画面 | URL | 何がわかるか |
|---|---|---|
| 診断ファネル計測 | `/ops/metrics` | 診断開始・完了・相談CTAクリックの件数、UTM流入元別の内訳。Salesforce連携の有効/無効に関わらず正しく集計される |
| 診断結果メール送信失敗一覧 | `/ops/diagnosis-result-emails` | 結果メール送信に失敗した診断の一覧、個別の手動再送 |
| Salesforce連携キュー | `/ops/integration-events` | 診断開始/完了/相談クリック等のイベントの生ログ、失敗イベントの個別・一括再送 |
| 医院一覧 | `/ops/dashboard` | 医院・契約状態のクロステナント確認 |

全ての閲覧・操作は`AuditLog`に記録される（誰が・いつ・何を見た/操作したか）。

## 2. 外部サービス依存と障害時の影響

| サービス | 用途 | 現在の状態（コード上のデフォルト） | 障害/未設定時の挙動 |
|---|---|---|---|
| Vercel | ホスティング・ビルド・Cron | 稼働中 | サイト全体が停止。Vercelステータスページで確認 |
| Neon (Postgres) | 本番DB | 稼働中 | 診断・認証・課金すべて停止。Neonコンソールで確認 |
| Resend | 診断結果・認証・課金通知メール送信 | `RESULT_EMAIL_PROVIDER`が`resend`なら有効 | 送信失敗は**診断処理自体は失敗にしない**（結果は保存され、ユーザーは結果画面へ進める）。ただし失敗した個別メールは`/ops/diagnosis-result-emails`で確認・再送が必要。ドメイン認証(SPF/DKIM)はResendダッシュボード側の設定で、コードからは検証できない |
| OpenAI | AI集患スコア計測 | `AI_MEASUREMENT_PROVIDER=openai`時に必須 | 設定不備・API障害時は診断API自体が500エラーで停止する（silent fallbackなし） |
| Twilio Verify | SMS認証（有料プラン契約時） | 審査状況に依存 | 無料診断・結果閲覧・TimeRex相談には影響しない（有料契約フローのみ） |
| Stripe | 課金 | `BILLING_PROVIDER`が`stripe`なら有効 | 無料診断・TimeRex相談には影響しない（有料プラン契約のみ） |
| Salesforce | CRM連携 | デフォルト`disabled` | 無効中でも診断・認証・メール送信は正常動作する（`IntegrationEvent`キューに保留され、有効化後に遡及同期される） |
| TimeRex | 相談予約カレンダー埋め込み・外部リンク | 常時有効（`NEXT_PUBLIC_SPECIALIST_BOOKING_URL`） | 埋め込みスクリプト読み込み失敗時も、結果ページに常時表示のフォールバックリンクが残るため予約導線は途切れない |

## 3. 主要環境変数（名前のみ、値は記載しない）

Vercelの `dent-shift-production` プロジェクトで確認する。

- `DATABASE_URL`
- `APP_BASE_URL`
- `RESULT_EMAIL_PROVIDER` / `RESEND_API_KEY` / `RESEND_API_KEY_DENTSHIFT` / `RESULT_EMAIL_FROM`
- `AI_MEASUREMENT_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_AI_MEASUREMENT_MODEL`
- `NEXT_PUBLIC_SPECIALIST_BOOKING_URL`（TimeRex予約URL。LP/結果ページ/メールで共通利用）
- `NEXT_PUBLIC_SUPPORT_PHONE_NUMBER`
- `BILLING_PROVIDER` / `STRIPE_*`（有料プラン関連、無料診断フローには不使用）
- `SMS_PROVIDER` / `TWILIO_*`（有料プラン契約フローのみ）
- `SALESFORCE_PROVIDER`（デフォルトdisabled）
- `TIMEREX_WEBHOOK_SECRET`（未設定時はWebhook自体が503で無効化される。予約発生をシステム的に検知する唯一の経路のため、設定する場合はTimeRex側でのWebhook URL登録も併せて必要）
- `CRON_SECRET`（Salesforce再試行Cronの認証。Vercel Cronが自動付与）

## 4. よくある障害パターンと対応

### 診断結果メールが届かないという問い合わせ
1. `/ops/diagnosis-result-emails` で対象診断が一覧にあるか確認
2. あれば「再送する」をクリック
3. 再送も失敗する場合、Resendのドメイン認証状態（SPF/DKIM）をResendダッシュボードで確認
4. 一覧に無い場合は、そもそも送信が試みられていない可能性がある。診断結果自体が保存されているか`/ops/dashboard`から確認

### 診断フォーム送信が500エラーになる
1. `AI_MEASUREMENT_PROVIDER`・`OPENAI_API_KEY`がVercelに正しく設定されているか確認（未設定・不正値は明示的に500を返す設計）
2. VercelのFunction Logsで`[POST /api/diagnosis]`のエラーログを確認

### TimeRexの予約が入ったか分からない
- 現状、Webhook（`TIMEREX_WEBHOOK_SECRET`）が本番で設定・TimeRex側で登録されていない限り、システム上で予約発生を検知する手段はない
- 当面はTimeRexダッシュボード側の通知機能に依存する運用となる（本ドキュメント作成時点では未確認）

### Salesforce連携イベントが溜まっている
1. `/ops/integration-events`で`status=failed`かつ`retryCount≧8`のイベントを確認
2. 原因（認証エラー等）を解消後、個別または一括で再送

## 5. 本番デプロイ

- ホスティング: Vercel、プロジェクト `dent-shift-production`
- デプロイ方法: `vercel deploy --prod`（`VERCEL_ENV=production`環境で実行、`.vercel/project.json`をproduction用に切り替えて実行する運用）
- ビルドコマンド（`vercel.json`）: `npm run build:vercel` — production環境では`prisma migrate deploy`を自動実行してからNext.jsをビルドする
- ドメインエイリアス: `dentshift.jp` / `www.dentshift.jp` / `app.dentshift.jp`

## 6. エラー監視について

現時点でSentry等の外部エラー監視サービスは導入されていない。エラーはVercelのFunction Logsに`console.error`として出力される。障害の能動的な検知は、Vercelログの定期確認または上記opsツールでの確認に依存する。
