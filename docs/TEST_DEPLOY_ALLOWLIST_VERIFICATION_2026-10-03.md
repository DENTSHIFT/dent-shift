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

| 時刻(JST) | 操作 | 結果 |
|---|---|---|
| 22:00頃 | `git push origin feature/salesforce-crm-sync`(`583316c..d7b6942`) | Vercel Preview `d7b6942` ビルド → Ready(46s) |
| 22:05頃 | Vercel `dent-shift-test` Production に `SALESFORCE_SYNC_CLINIC_ALLOWLIST=cmuqz3wv40003vb6wrh259iph`(Config型、Productionのみ)を追加 | 追加成功(「再デプロイが必要」表示) |
| 22:08頃 | Preview `d7b6942` の「…」→「Promote to Production」(本番環境変数で再ビルド。Force等は未使用) | Production デプロイ `7PYtWGzdD` ビルド開始 |
| 22:00:37 | Production `7PYtWGzdD`(ソース `d7b6942`)Ready(57s)。`test.dentshift.jp` に反映。ビルド警告10行は npm `install-scripts` 通知のみ | 配備完了 |
| 22:01:22 | `GET /api/ops/salesforce-connection-check` → 401(ログインが必要) | 接続先の読み取り確認は運用者ログインが無いため未実施(代替: Cronログ/イベント結果で判定) |
| 22:01:38 | テストDB `IntegrationEvent` に検証イベント3件をINSERT(status pending, retryCount 0) | `alwverify20261003a1`(A, clinicIdあり)/ `alwverify20261003a2`(clinicId NULL, contactId=AのContact)/ `alwverify20261003b1`(B, clinicIdあり) |
| 22:07:46 | 直前のCron(22:00:41、旧配備/新配備の切替直後)は検証イベント作成前のため対象外。次回Cron(22:15)待ち | 3件とも pending / retryCount 0 のまま |
| 22:15:41 | Cron `GET /api/internal/salesforce/retry`(新配備 `7PYtWGzdD` / host `dent-shift-test-71b8on1w2…`、vercel-cron、200、3.27s) | Vercelログの外部API記録: `inspiration-customization-3670--dsverify.sandbox.my.salesforce.com` へ OAuth 1回、`Lead GET(DentShift_Clinic_Id__c=A)` → `Account/Contact/Opportunity PATCH` のシーケンスが **2回**(A1・A2分)。**医院B向けの呼び出しは0回** |
| 22:16:56 (DB) | 検証イベントの状態 | `a1`: **synced**(attempted/processed 13:15:43 UTC)/ `a2`(clinicId NULL・contact経由): **synced**(13:15:44)/ `b1`: **pending・retryCount 0・lastAttemptedAt なし・nextRetryAt なし**(保持) |

## 2. 実測結果まとめ

| 確認項目 | 結果 |
|---|---|
| 接続先 | `dsverify` Sandbox(Cronの外部API記録のホスト名で確認。組織ID照合はアプリ内 `SALESFORCE_EXPECTED_ORG_ID` チェックを通過して書き込みが成功したことで間接確認。`/api/ops/salesforce-connection-check` は運用者ログインが無く未実施) |
| 許可医院(A)の同期 | ✓ 2件とも synced。Sandboxの Account/Contact/Opportunity(契約 `cmur2hsyx000214cgfnm82jys`)が外部IDでupsertされた |
| Contact経由イベント(clinicId NULL) | ✓ Cronで取得され、contact→医院Aに解決して同期(a2) |
| 許可外(B)の保持 | ✓ 外部API呼び出し0回、status pending・retryCount 0・試行日時なし・nextRetryAt なし |
| 実通知 | SMS/メール/Stripe/TimeRex は発生せず(Cronの外部APIはSalesforce Sandboxのみ) |
| 許可リスト | `SALESFORCE_SYNC_CLINIC_ALLOWLIST=cmuqz3wv40003vb6wrh259iph`(医院Aのみ)を**維持**。無制限同期へは戻さない |

## 3. 残件
- 不明なテスト失敗1回(ローカル `vitest`、2026-10-03 21:43頃、失敗テスト名未捕捉。以後5回連続全件通過)— 未解決事項として保持。再発時は失敗箇所を特定するまで検証を止める。
- `SALESFORCE_PROVIDER` の値は Vercel 上で秘密扱いのため未表示(Stage2報告では `salesforce`。Cronが実際にSandboxへ書き込んだことから有効と判断)。
- 検証イベント3件(`alwverify20261003a1/a2/b1`)は削除せず残す。`b1` は許可外のため以後も pending のまま(Cronの抽出対象外)。
- 本番DB適用・本番メタデータ配備・本番データ変更は引き続き未承認。
