# `dent-shift-test` 段階的同期ガード 配備・動作確認記録(2026-10-03)

PO承認(2026-10-03): `dent-shift-test` 限定で `1cb6d03` の配備と許可リストの動作確認。本番は対象外。

## 0. 実行前記録

| 項目 | 内容 |
|---|---|
| 対象プロジェクト | Vercel `dent-shift-test` / `https://test.dentshift.jp`(Git連携: `DENTSHIFT/dent-shift`、本ブランチのpushはPreviewとしてビルドされ、Productionエイリアスへは「Promote to Production」で割り当てる = `NEXT_TEST_DEPLOYMENT_PLAN_2026-10-03.md` 5章の通常手順。Force/チェック回避は使わない) |
| 配備コミット | `1cb6d03`(`feature/salesforce-crm-sync`、masterへ未マージ) |
| 現在のProduction配備 | `583316c`(`fix(timerex): …`)の Production rebuild(`Cz89jumpZ`、2026-10-03) |
| 接続先Salesforce | `dent-shift-test` Production環境変数に `SALESFORCE_PROVIDER` / `SALESFORCE_CLIENT_ID` / `SALESFORCE_CLIENT_SECRET` / `SALESFORCE_LOGIN_URL` / `SALESFORCE_EXPECTED_ORG_ID` が設定済み(値は未表示)。期待は Sandbox `dsverify`(`--dsverify.sandbox.`、組織ID先頭 `00DBS`)。配備後に `/api/ops/salesforce-connection-check`(読み取り専用)で一致を確認する |
| DB | Neon `dent-shift-test-db`(`restless-art-55621985`、main `br-green-morning-b3tfnlii`)。Clinic 26件、保留中(pending/failed)の`IntegrationEvent` **0件**(全件synced) |
| 現在の環境変数(変更前) | `SALESFORCE_SYNC_CLINIC_ALLOWLIST` **未設定**(→配備直後は全件停止)。`SMS_PROVIDER`(Production、値未表示。本作業では変更しない)。メール・Stripe・TimeRex設定は変更しない |
| 許可する承認済みダミー医院 | **A: `cmuqz3wv40003vb6wrh259iph`**(名称「【検証】Stripe実測証歯科」、URL `example-stripecheck-verify.jp`、Contact `cmuqz3wxa0005vb6wdz6ks7l8`(completed)、既存イベント6件すべてsynced) |
| 許可外(保持)確認に使う承認済みダミー医院 | **B: `cmuifpa2m0000nrwzphz5r168`**(名称「E2Eリセット」、URL `example.com/e2e-reset`、Contact `cmuifpagy0002nrwzjf5oc4e6`(payment)、既存イベント13件synced。TimeRex調査に使った承認済みテスト医院) |
| 検証イベント(作成予定、テストDBのみ) | 保留中イベントが0件のため、`IntegrationEvent` に **3件**を手動INSERT: (1) A・`diagnosis_completed`・clinicIdあり → 送信される想定、(2) A・`diagnosis_completed`・**clinicId NULL + contactId=A のContact** → contact経由で取得・送信される想定、(3) B・`diagnosis_completed`・clinicIdあり → **held**(status pending・retryCount 0 のまま)想定。payloadはダミー。IDは作成後に本書へ記録 |
| 実通知 | SMS/メール/Stripe/TimeRex はいずれも発生させない(IntegrationEventのINSERTは外部通知を伴わない。Salesforce Sandboxへの書き込みはAの医院分のみ) |
| 復旧手順 | (1) Vercel「Deployments」で `Cz89jumpZ`(`583316c`)を「Promote to Production」で戻す(`NEXT_TEST_DEPLOYMENT_PLAN` 5章)。(2) `SALESFORCE_SYNC_CLINIC_ALLOWLIST` は残しても `583316c` は参照しないため実害なし。(3) 検証イベント3件は削除せず残す(必要なら別途承認) |
| 検証後 | 許可リストはAのみのまま維持し、無制限同期へ戻さない |

## 1. 実施ログ
(以下、実施順に追記)
