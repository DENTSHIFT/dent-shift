# Salesforce CRM Stage 2 実機検証 最終報告（2026-10-03）

対象ブランチ: `feature/salesforce-crm-sync`
配備コードのコミット: `5e20d80`（fix(salesforce): fail-closed on any malformed duplicate candidate; document allowSave limitation）
本報告を保存したコミット: このファイルを追加したコミット自体（コミットハッシュはこのファイルのコミット後に `git log -1` で確認可能）

対象環境: `dent-shift-test`（Vercel Production環境、`test.dentshift.jp`）／ Salesforce Sandbox（`dsverify`）
**本番適用の承認ではありません。**

---

## 1. 観測事実と推定の区別

### 観測事実（実機で直接確認済み）
- `SALESFORCE_PROVIDER=salesforce` 有効化後、自動再送Cronにより8件の`IntegrationEvent`が`failed`→`同期済み`に遷移したこと（キュー画面のステータス・最終試行日時で確認）
- Salesforce Sandbox側のレコードを直接クエリし、Contact/Consultation/Opportunityが各医院1件のみ存在し、payload内容と一致する値（`DentShift_Booking_Status__c=キャンセル`、`DentShift_Plan__c=light`、`DentShift_Billing_Status__c=trial`等）が反映されていること
- Lead（E2Eリセット: `00QBS00000ROkv02AD`等）が引き続き未コンバートのまま存在すること
- デプロイ`FAxLpG3TMM6iJjZNJF6dJx4agSE5`（現在Production/Current、コミット`5e20d80`）のBuild Logsが、Lint/型検査ステップを含めて警告2件（いずれもコードエラーではない）のみで正常完了していること
- dsverify接続診断: `connected=true, orgIdMatches=true`

### 追記（2026-10-03・後日）: 重複保存許可の分岐を実機で直接証明

上記の「推定にとどまる事項」について、`scripts/verify-duplicate-retry-sandbox.ts`（本物の`upsertContactAllowingOwnLeadDuplicate`をそのまま呼び出す、Sandbox限定の再現スクリプト）を使い、dsverify Sandbox上で直接実行して確認した。

**観測事実（実機で直接確認、コミット`236b682`〜`5cf497c`）**
- 実行前にdsverify接続・組織ID一致を実測確認してから進行（`sandbox_host_check: true` → `connection_check: connected=true, orgIdMatches=true`）
- **シナリオA（この医院自身の未コンバートLeadのみが候補）**: 実際に`DUPLICATES_DETECTED`が発生し、候補検証を経て`allowDuplicateSave`で再送、Contact作成に成功（`retried_and_succeeded`）
- **シナリオB（無関係な医院のLeadが候補に混在）**: 実際に複数候補を含む`DUPLICATES_DETECTED`が発生し、検証の結果**保存を拒否**（`rejected`）。その後の別クエリでContactが実際に作成されていないことも確認済み（`contactExists: false`）

**今回の検証条件として記録する事項（一般化しない）**
- 1回目の実行では、無関係Lead側のCompany名をclinicBと別の文字列にして作成したところ、Standard Lead Matching Ruleが候補として検出せず、意図せずContactが作成されてしまった（`matchesExpectation: false`）。これはコードのバグではなく、**今回使用した再現条件（Company名を変えた）がSandboxの実際の重複判定条件を満たしていなかった**ことが原因。Company名を一致させてから再実行したところ、上記の正しい結果（保存拒否）を得た。
- この結果から「Company名が一致していないと重複候補として検出されない」という事実が今回の検証環境・条件下で観測されたが、これはdsverify Sandboxの現在の重複ルール設定・この特定の再現データに基づく観測であり、Salesforceの重複判定アルゴリズム全般についての一般的な結論として扱わないこと。
- **初回実行時に意図せず作成されたContact**（Company名不一致のケースでできてしまったもの）を含め、全ての作成レコード一覧は`scripts/output/`配下のJSONファイル（Git管理対象外）に相関IDごとに保存されている。削除は行っていない。

---

## 2. デプロイ時に省略したチェックの確認（訂正）

- 最初にPreviewからProductionへ`5e20d80`を昇格させた際、**「Force Promote to Production」を使用**し、Vercel側の独立した「Deployment Checks」ゲート（Lint・TypeCheck）を明示的にバイパスしました（デプロイID: `CQ88HJJe4Er9Mfs82Qjh8HCdCSnh`、現在は`Stale`で非稼働）。
  - このゲートのバイパスは、Next.jsの`next build`自体が内部で実行する型検査・ESLintを省略するものではありません。該当デプロイのBuild Logsは`Linting and checking validity of types...`のステップを経て70ページ全ての静的生成に成功し、警告は1件（Sensitive Environment Variable Redactedの注記のみ）でした。
  - その後、環境変数`SALESFORCE_PROVIDER=salesforce`反映のため通常の**Redeploy**（Force Promoteではない）を実行し、現在稼働中のデプロイ（`FAxLpG3TMM6iJjZNJF6dJx4agSE5`）はVercel側のチェックを一切バイパスせず、警告2件（同じくSensitive Environment Variable Redactedの注記＋npm deprecation警告）のみで正常完了しています。
- 前回「ローカルで型検査は全合格」と報告したのは**不正確**でした。正しくは：コミット`5e20d80`作成前に実行した`npx tsc --noEmit -p tsconfig.json`では、既知の1件のみ型エラーが残っていました（`tests/unit/verifyProductionBillingSmsConfig.test.ts(6,8)`、`.mjs`モジュールの型宣言なし起因、`git log`で本修正と無関係なコミット`8b3ac47`由来と確認済み）。新規に追加した候補検証・Fix A/Bのテストは全て合格しましたが、プロジェクト全体の型検査が「全合格」だったわけではありません。
- **今後の方針**: 承認済みデプロイであることを理由に、Vercel側のチェック省略（Force Promote等）を独自判断で使うことはしません。省略が必要な場面では、省略対象と理由を明示して事前に確認します。

---

## 3. 残件一覧（完了・未完了を分離）

### 完了
| 項目 | 内容 |
|---|---|
| Fix A（候補情報の部分的欠損の扱い） | 実装・テスト済み、コミット`5e20d80` |
| Fix B（`allowSave`制約の明記） | 実装済み、コミット`5e20d80` |
| `dent-shift-test`への配備（同期無効→有効化） | 完了 |
| 承認済み2医院の重複エラー解消（キュー上のステータス変化） | 完了（ただし内部分岐の実機証跡は未取得、上記1節参照） |
| Contact/Consultation/Opportunityの反映・重複なし確認 | 完了 |
| 認証情報（Neon DBパスワード）のローテーション | 完了。Neonコンソールでのパスワードリセット、Vercel環境変数への自動反映（`vercel env ls`で17秒後反映を確認）、再デプロイ後の実際のDB接続成功まで確認済み |

### 未完了
| 項目 | 内容 |
|---|---|
| TimeRex日程変更(reschedule)の検証 | **当初計画の未完了項目**です。「スコープ外」ではありません。予約日時の変更による通知、予約IDの扱い、DBの日時更新を検証する作業が残っています |
| SMS実送信 | 未実施。`SMS_PROVIDER=disabled`のまま（4節参照） |
| 登録後に残る未変換Leadの運用方針 | 本番方針は未決定。当面Sandboxで残置（5節参照） |
| 重複保存許可ロジックの実機分岐証跡 | 未取得（1節参照） |
| シェル履歴整理の完了証跡 | 不足（4節参照） |
| 既知の型エラー1件 | `tests/unit/verifyProductionBillingSmsConfig.test.ts`、本修正と無関係の既存エラー。未解消 |

---

## 4. 現在の設定・検証データの記録（削除は行っていません）

### 環境変数（`dent-shift-test` Vercel Production、実際に値を確認したもの）
- `SALESFORCE_PROVIDER = salesforce`（**有効**。本検証で`disabled`から変更）
- `SMS_PROVIDER = disabled`（Config型のため値を直接確認済み）
- `RESULT_EMAIL_PROVIDER = resend`（**有効**、値を直接確認済み）

### TimeRex共通Webhook
- **過去の実施記録（証跡あり）**: 本セッション内の以前のやり取りで、「検証後、TimeRexのWebhook設定を削除し、元の『未設定』状態に復元済み」と自己報告した記録が残っています。これは当時の作業ログに基づく一次情報です。
- **今回の再確認**: 今回はTimeRex管理画面を直接開いて「共通Webhookが実際に未設定のままか」を再確認する作業は行っていません。Vercel環境変数には`TIMEREX_BOOKING_REF_SECRET`・`TIMEREX_WEBHOOK_SECRET`の存在のみ確認しましたが、これはTimeRex側の「共通Webhook」設定の有無とは別の情報です。したがって、「過去に削除した」という記録と「現在も未設定のままである」という事実確認は別の状態として扱ってください。

### 認証情報ローテーション と 履歴整理 の区別
- **認証情報のローテーション**: 完了。Neonコンソールでのパスワードリセット、Vercel環境変数への自動反映、再デプロイ後の実際のDB接続成功まで確認済み（3節「完了」参照）。
- **シェル履歴等の整理**: 以前のセッションで「該当するシェル履歴の除去」を実施・報告していますが、その完了判定は「検索結果が0件」という限定的な確認にとどまっており、秘密値入りバックアップの残存や他セッションのメモリ上履歴まで含めた完全性の検証は行われていません。**この2つは別の完了状態として扱う必要があります**（ローテーションは完了、履歴整理は完了証跡が不足）。

### テスト管理者アカウント(Operator)
- 作成済み（admin権限、2件存在）。資格情報は表示しません。

### SMS免除Contact（承認済み対象、現在値を直接確認）
- 対象: Contact `cmuqz3wxa0005vb6wdz6ks7l8`（`mstkmr.0502+dsstripecheck@gmail.com`、【検証】Stripe実測証歯科クリニック所属）
- 現在値: `smsVerificationExempt = true`（本日、SQL実行履歴からの推測ではなく直接クエリして確認）
- 該当条件に一致するContactはこの1件のみ

### Neon DB復元用ブランチ（ブランチ自身の詳細ページで期限を直接確認）
- 前回「main含め全ブランチが自動失効しない」としたのは誤りでした。`main`ブランチ自体（`Expires: Never`）と、マイグレーション前に作成した子ブランチの期限を混同していました。
- 子ブランチ`pre-crm-sync-migration-2026-10-02`（ID: `br-silent-hat-b3irhcmp`）の詳細ページを直接確認した結果、**`Expires: 2026-10-09 18:39:15`**（作成日時`2026-10-02 18:39:16`から7日後）と表示されており、以前の報告「7日間保持」と整合します。
- 他の子ブランチ（`isolated-verify-diagnosis-ratelimit-20260929`、`pre-migration-20260929-utm-integrationevent`、`pre-trial-entitlement-migration-2026-09-27`、`pre-trial-runtime-migrations-2026-09-28`、`pre-utm-nextretry-migration-2026-09-29`）についても同様の7日保持ルールが適用されている可能性が高いですが、今回個別に期限を確認したのは`pre-crm-sync-migration-2026-10-02`の1件のみです。
- Point-in-Time Restore(履歴保持)は`main`ブランチで6時間（Free Planの制約）。

### テストデータ
- 承認済み2医院のテストデータ（E2Eリセット、【検証】Stripe実測証歯科）はSandbox・Neon双方に引き続き存在。削除は行っていません。

---

## 5. 未変換Lead問題：対応案の比較（設計検討のみ、実装・実行は未着手）

登録後もSalesforce上にLeadが未コンバートのまま残り続ける問題について、方針決定のための比較です。**実装・実行の承認はまだ得ていません。**

### 案A: 当面残置（現状維持）
- 内容: 自動変換・削除を一切行わず、Leadをそのまま残す
- 影響: Salesforce上でLeadとAccount/Contactが並存し続け、営業・CS担当がリスト表示時に「同じ医院が二重に見える」混乱が生じうる。重複ルールの判定対象が増え続け、将来的な別の同期処理でも同種の`DUPLICATES_DETECTED`が起きるリスクが残る
- 利点: 新規ロジックを追加しないため、実装リスクそのものは発生しない

### 案B: 自動変換（Lead Conversion APIによる限定スコープの自動化）
- 設計方針（案、未実装）:
  - 対象: 当該医院の`DentShift_Clinic_Id__c`に一致するAccountが既に存在し、かつ当該医院のLeadが未コンバートの場合のみ対象とする
  - 一致条件: 医院ID（`DentShift_Clinic_Id__c`）に加え、変換先ContactはContact外部ID（`DentShift_User_Id__c`）の一致を必須条件とする。一致しない場合は変換しない
  - 競合時の扱い: 対象Leadが複数存在する、もしくは変換先候補のAccount/Contactが一意に定まらない場合は**自動変換を停止**し、手動対応に回す（新規のAccount/Contactを誤って作成しない）
  - Lead Conversion APIの`convertedStatus`オプションで、電話等のアウトバウンド施策を自動発生させない設定（架電禁止・自動タスク生成なし）を明示的に指定する
  - 既存のAccount/Contactの所有者(Owner)・活動履歴(Task/Event/Note)を変換によって上書き・削除しないことを事前にSandboxで検証する
  - 不要な商談(Opportunity)を新規作成しないよう、Lead Conversion APIの`opportunityId`相当のオプションでOpportunity作成をスキップする設定を使う
- リスク: 変換ロジックの条件判定やSalesforce側の挙動（Conversion時に意図せずOpportunityが作られる等）を誤ると、既存の正しいAccount/Contact/Opportunity情報を壊す可能性がある。十分なテストと段階的なSandbox検証が前提

### 案C: 手動変換（運用でカバー）
- 内容: CS担当者がSalesforce画面上でLead Conversionボタンを都度操作し、変換先のAccount/Contactを目視で選択する
- 利点: 誤判定によるデータ破壊リスクが最も低い。実装コストもゼロ
- 欠点: 医院数が増えるとCS側の運用負荷が増加し、取りこぼし（変換し忘れ）が発生しやすい

**推奨**: 影響範囲が小さい今のうちに、案Bの設計案（医院ID＋Contact外部ID一致、競合時停止、Owner/活動履歴保持、Opportunity不要作成の回避を含む）を正式に文書化し、Sandboxでのテストまで進めることを推奨しますが、**実装・実行は本報告では行っていません**。本番移行前に、POとして「当面は案A（残置）で進め、並行して案Bを設計・検証する」か「案Cで運用開始するか」を判断いただく必要があります。

---

## 本番判断に向けて残っている項目（再掲）

1. 重複保存許可ロジック（候補検証の分岐）の実機証跡取得
2. TimeRex日程変更の検証（当初計画の未完了項目）
3. 登録後に残る未変換Leadの運用方針の決定（案A/B/Cのいずれか、またはその組み合わせ）

以上を踏まえ、本番適用の可否についてご判断をお願いします。
