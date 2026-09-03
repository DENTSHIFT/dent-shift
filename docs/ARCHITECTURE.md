# DENT SHIFT — Architecture (P0)

本番リポジトリは未作成のため、新規プロジェクトとして設計する。過去のChatGPTプロトタイプはUX/デザイン参考のみで、本番コードの正本ではない。

## A. 推奨技術スタック(提案・要確認)

MVPを2026-10-01までに、小規模チーム(実質1〜数名)で到達させることを最優先し、あえて枯れた構成にしている。**最終決定は未確定事項であり、ここでは推奨案として提示する。**

| レイヤ | 推奨 | 理由 |
|---|---|---|
| フロントエンド/BFF | Next.js (App Router) + TypeScript | フロントとAPIを1リポジトリで完結でき、立ち上げが速い |
| DB | PostgreSQL | RLS(Row Level Security)で `clinic_id` によるテナント分離を宣言的に強制できる |
| ORM/DBアクセス | Prisma | 型安全なドメインモデル、マイグレーション管理が容易 |
| Auth | Supabase Auth または Auth.js(Postgres連携) | メール/パスワードのみで開始でき、電話番号不要の要件に合う |
| 非同期ジョブ | Postgresベースのジョブキュー(pg-boss等)、必要に応じてRedis+BullMQへ拡張 | AI診断はレイテンシがあるため非同期実行が必須 |
| AI連携 | 自前の「AI Provider Interface」層 + ChatGPT/Gemini等のAPIをmock/sandbox/実プロバイダで差し替え可能に | 本番API仕様未確定のため抽象化が必須 |
| 決済 | Stripe Billing(想定、最終選定は未確定) | Webhook駆動のサブスクリプション状態管理と相性が良い |
| メール送信 | Resend等のトランザクションメールAPI(最終選定は未確定) | 電話番号を使わない結果通知フローの要 |
| ホスティング | Vercel(Web) + マネージドPostgres(Supabase等) | インフラ運用コストを最小化 |

この構成は「未確定事項」を最終決定するものではなく、実装を始めるための出発点。ユーザー確認後に固定する。

## B. 新規ディレクトリ構成(提案)

MVP段階ではモノレポの複雑さを避け、単一Next.jsアプリ内をドメインごとにフォルダ分割する。将来分割が必要になれば `packages/` へ切り出す。

```
dent-shift/
  docs/
    PRODUCT_SPEC.md
    ARCHITECTURE.md
    DATA_MODEL.md
    SECURITY.md
    IMPLEMENTATION_PLAN.md
    P0_ACCEPTANCE.md
    DENT_SHIFT_CLAUDE_HANDOFF.md
  apps/
    web/                      # Next.js App Router
      app/
        (clinic)/             # 医院向けダッシュボード route group
        (public)/              # 無料診断・LP等 未認証route group
        (ops)/                 # 運営(管理/CS/分析/経理) route group
        api/                   # Route handlers (webhook等)
      lib/
        domain/
          clinics/
          diagnoses/
          competitors/
          ai-observations/
          improvement-tasks/
          subscriptions/
          payments/
          ambassadors/
          audit/
        ai-providers/          # Provider Interface + mock/sandbox/real実装
          provider-interface.ts
          providers/
            mock.ts
            chatgpt.ts
            gemini.ts
        scoring/                # 6領域100点スコアリングロジック
        jobs/                   # 非同期ジョブ定義(診断実行 等)
        auth/
        db/
          prisma/
            schema.prisma
      components/
    worker/                    # 将来、ジョブ実行を分離する場合の受け皿(P0では未使用可)
  packages/                    # 将来の切り出し用(P0では空でよい)
```

## C. P0アーキテクチャ(処理フロー)

```
[医院名 or 公式URL 入力]
        |
        v
[clinic レコード作成/重複検出] --- 既存clinic候補があれば提示
        |
        v
[diagnosis レコード作成 (status: queued)]
        |
        v
[非同期ジョブ: AI Provider Interface 経由で各AIへ問い合わせ]
        |  (P0初期はmock/sandboxプロバイダで疎通確認、実プロバイダは後続で差し替え)
        v
[ai_observations 保存 (mention/citation/rank/根拠/取得日時)]
        |
        v
[競合3院の同条件計測]
        |
        v
[スコアリングエンジン: 6領域100点 + 敗因候補 + 改善TOP3を算出]
        |
        v
[diagnosis結果を保存、メールで結果を通知(電話番号不要)]
        |
        v
[結果ページ表示 → プラン比較 → オンライン契約 → 初期オンボーディング]
```

外部書き込み(広告・GBP・医院情報の変更)を伴う機能はP0の対象外。読み取り・分析・提案までに留め、実行には人の承認ステップを挟む設計を前提とする(詳細は `SECURITY.md`)。

## H. 最初に着手する最小 Vertical Slice

1. 医院名または公式サイトURLを入力するフォーム(電話番号フィールドなし)
2. 送信で `clinic` レコード作成(重複ドメイン検出のみ実装、統合UIはP1以降)
3. `diagnosis` レコード作成、ジョブキューへ投入
4. AI Provider Interfaceは最初は `mock` プロバイダのみに接続(固定/擬似応答を返す)。レスポンスにはmockである旨のフラグを持たせ、UI・レポートでは「サンプル」であることを明示し、実績として表示しない
5. スコアリングエンジンで6領域の暫定スコアを算出(mockデータに対して計算ロジック自体は本番仕様で実装)
6. 結果をメールで送信し、結果ページに6領域スコア・改善TOP3(暫定)を表示
7. この時点ではcompetitor比較・SoV・医療広告チェックはUIのプレースホルダのみでよい(次のイテレーションで実データ化)

このスライスが通った時点で、実際のAIプロバイダ接続(sandbox→実API)に進む。全外部APIを最初から接続しない。
