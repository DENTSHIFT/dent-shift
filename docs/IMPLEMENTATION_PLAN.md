# DENT SHIFT — Implementation Plan (P0 → 2026-10-01)

作成日: 2026-09-03。目標リリース日: 2026-10-01(約4週間)。この期間の短さから、意図的に枯れた技術選定・最小スコープを取っている(`ARCHITECTURE.md` 参照)。

## G. 実装順(週次マイルストーン)

### Step 1 — 設計ドキュメント + リポジトリ初期化
- 本ドキュメント一式(`PRODUCT_SPEC.md` / `ARCHITECTURE.md` / `DATA_MODEL.md` / `SECURITY.md` / `P0_ACCEPTANCE.md`)をユーザーが確認・承認
- リポジトリ初期化、Next.js + TypeScript + Prisma のひな形構築、Lint/Format/CI最小構成

### Step 2 — P0基盤(アーキテクチャ/DB/認証/テナント分離)
- `DATA_MODEL.md` のスキーマをPrisma migrationとして実装
- RLSポリシー設定、認証基盤の接続、`clinic_id` スコープの共通ミドルウェア実装
- AI Provider Interface の抽象層 + mockプロバイダ実装

### Step 3 — 無料診断 Vertical Slice
- `ARCHITECTURE.md` の H(最小vertical slice)を実装
- 医院名/URL入力 → clinic作成 → diagnosis作成 → mockプロバイダ経由分析 → 6領域スコア → 改善TOP3(暫定) → 結果メール → 結果ページ
- この時点で「サンプルデータであること」が全画面で明示されているかを確認

### Step 4 — 認証・無料会員
- 医院側アカウント作成(メールのみ)、ログイン、複数医院/複数担当者の紐付け

### Step 5 — プラン・契約・決済
- プラン比較UI、Stripe(想定)連携、Webhookによるサブスクリプション状態遷移(`SECURITY.md` 参照)
- 進捗: 月額料金(税込)を確定し、Stripeサンドボックスの商品・Checkout・税設定・署名検証付きWebhook・冪等処理を接続済み。テストカードで契約、初回入金、DENT SHIFTへの有効契約反映まで確認済み。本番モードへの切替は正式公開時に別途承認を得て行う。

### Step 5.5 — 契約後オンボーディング
- 契約直後は初期設定画面へ遷移し、医院アカウント、契約反映、初回AI集患診断の3項目を案内する。
- Stripe Webhook反映前は「反映を確認中」と表示し、未反映を契約失敗と誤認させない。
- スペシャリスト相談は45分の任意項目として分離し、利用開始の必須条件にはしない。

### Step 6 — ダッシュボード
- 総合集患スコア、前回比、AI選定シェア、競合差、改善TOP3、成果KPIの一覧画面
- 進捗: 医院単位の診断サマリーと契約状況表示まで実装済み。未連携指標は推測値を表示しない。

### Step 7 — CRM連携
- 2026-09-20更新: 自社開発方針を撤回し、Salesforce CRM同期(Lead upsert・行動イベント同期)を実装済み(`src/server/services/salesforceSync.ts`、PRODUCT_SPEC.md 2章10項参照)
- 医院側(院長/スタッフ/制作会社)と運営側(管理/CS/分析/経理)のビュー分離はP1以降で検討
- `improvement_tasks` の承認ワークフローUI(検出→提案→承認→対応→再計測)

### Step 8 — アンバサダー
- 紹介コード発行、`attributions` の追跡(有料契約+初回入金確定時点のみ成果化)

### Step 9 — 相談予約(希望者のみ)
- スペシャリスト相談への導線(必須化しない)
- 進捗: 診断結果画面の任意CTA(`ConsultationCta`/`PhoneInquiryCta`)・クリック計測(`/api/events/track`)・
  TimeRex予約状態の暫定Webhook(`/api/webhooks/timerex`)まで実装済み(Step7と合わせて対応)。

### Step 10 — 外部計測連携の下地
- GA4 / Search Console等、P1本格実装の前段としての接続点だけ用意(P0では必須にしない)
- 2026-09-20時点: 本項目はP0で必須ではないとの本文の位置づけどおり未着手。P0で使う画面が
  存在しない段階での先行実装は「使われない足場」になるため、実際にP1着手する時点で
  billingConfig.ts等と同型のconfigパターンを踏襲して実装する。

## 進め方の原則

- 各StepはUIの「loading/success/empty/not_configured/needs_reauth/temporarily_unavailable/insufficient_data/error」状態を最初から設計に含める。
- 実プロバイダ接続はStep 3のvertical sliceが通ってから段階的に行い、mock/sandbox/実プロバイダを設定で切り替え可能にする。
- P1/P2機能(`PRODUCT_SPEC.md` 5節)はP0期間中は着手しない。
- 各Stepの完了判定は `P0_ACCEPTANCE.md` のチェックリストに対応させる。

## 未確定事項によるリスク

技術スタック最終選定・決済/メール基盤最終選定・本番AI計測方式・API原価等が未確定のため、これらが確定するまでStep 5以降(特に決済連携、実プロバイダ接続)は並行して仕様確認を進める必要がある。4週間という期間を踏まえ、これらの確定を最優先の意思決定事項としてユーザーに提示する。
