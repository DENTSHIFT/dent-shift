# 検証環境 終了時の戻す／残す対象一覧 — 2026-10-03時点

本ドキュメントは一覧の作成のみを目的とする。削除・権限変更・本番移行・TimeRexサポートへの追加送信はこの作業では行っていない。

## 1. テストデータ(Salesforce Sandbox `dsverify`)

- Stage1検証で作成された Lead / Account 等のテストレコード(`docs/SALESFORCE_SANDBOX_TEST_DATA_AUDIT.md` 参照)。
- **要確認**: どのレコードを残す(継続検証用)か、どのレコードを削除対象とするかは本ドキュメント作成時点で未確定。削除は別途承認が必要(Sandboxのみとはいえ、削除は破壊的操作のため)。

## 2. テスト医院・テストContact(`dent-shift-test` DB)

- 承認済みテスト医院(E2Eリセット用Contact、`clinicId` はds_ref調査に使用したもの)。
- `ConsultationBooking` の調査用レコード(`id: cmurs4ksx0001vqv07stu304o`、`timerexEventId: dfef9bfc3b3e70d79f94`、状態: cancelled)は、TimeRexサポートの調査継続のため**削除せず保持**(本人からも明示承認済み)。
- **要確認**: 他にも過去のセッションで作成された一時的なテストContact/予約レコードが残っている可能性がある。棚卸しは未実施。

## 3. 管理者アカウント

- TimeRex「DENT SHIFT検証専用チーム」(`dentshift-verify-20261003`)の管理者アカウント(DENT SHIFTシフト、`info@dentshift.jp`)は既存の検証用アカウントであり、本セッションで新規作成したものではない。**残す**(検証継続に必要)。

## 4. SMS認証免除(`smsVerificationExempt`)設定

- **要確認**: どのContactに対して本フラグが設定されているか、本セッション内では新規に変更していない(コードレビューで言及されたのみ)。削除・変更が必要な場合は別途棚卸しが必要。

## 5. 検証用Webhook(TimeRex)

- Webhook URL: `https://test.dentshift.jp/api/webhooks/timerex`(TimeRex「DENT SHIFT検証専用チーム」に設定済み)。
- url_params/ds_ref欠落の原因調査が完了しTimeRexサポートの回答を得るまでは**残す**(削除すると再現調査ができなくなる)。

## 6. 復元用ブランチ・スタッシュ

- 確認した範囲(`git branch -a`, `git stash list`)では、backup/restore用の一時ブランチやstashは存在しない。
- 作業ブランチは `feature/salesforce-crm-sync` のみ(masterへの未マージ)。

## まとめ

この一覧は棚卸しの出発点であり、「要確認」と記載した項目は本ドキュメント作成時点で未解決。削除・権限変更はいずれも別途明示承認後に実施する。
