# Salesforce CRM連携 Stage 1 最終報告(Sandbox dsverify)

作成: 2026-10-02 / 対象ブランチ: `feature/salesforce-crm-sync`
範囲: Sandbox (`dsverify`) 内の検証のみ。本番Salesforce・master・Vercel Productionへの反映は一切行っていない。

## 1. 完了した変更と結果

### 1.1 リード変換時の電話禁止(DoNotCall)保持
- `salesforce/force-app/main/default/flows/DentShift_Preserve_Do_Not_Call_On_Convert.flow-meta.xml`
  Record-Triggered Flow(After Save, System Context)。`Database.convertLead()` と同一トランザクションで、禁止=trueのLeadの値を変換先Contactへ反映する。既存の禁止(true)を解除することはなく、同期ユーザー自身の権限は変更していない。
- 検証ルール `DentShift_Do_Not_Call_Reason_Required`(Lead・Contact)を、解除時のみのチェックから「false(通話可)なのに根拠が空」という常時チェックへ強化。解除・無根拠の新規作成・根拠の後削除の3パターンすべてを防ぐ。
- FlowはTooling APIの `FlowDefinition.Metadata.activeVersionNumber` 切り替えでFAIL(Flow無効)→PASS(Flow有効)の回帰を実際に確認した上で、正式なE2Eチェックとして `scripts/salesforce-sandbox-e2e.ts` に追加。

### 1.2 顧客管理画面(Lightning Record Page)の完成
- REST非同期retrieveの404だけで「手動UIしかない」と判断せず、SOAP Metadata API `retrieve()`/`checkRetrieveStatus()` + REST `deployRequest()` という公式手順を確認して採用(`scripts/salesforce-layout-metadata-deploy.mjs` でクラシックのページレイアウトへ項目・関連リストを追加)。
- Account・Contact・Opportunityの3画面は、ページレイアウトの変更が自動反映されない「静的な項目セクション」構成だったため(Leadのみ動的な「レコード詳細」構成で自動反映済みと確認)、`scripts/salesforce-flexipage-metadata-deploy.mjs` により既存タブ・項目・クイックアクションを一切変更せず、新規「DENT SHIFT」タブ(項目セクション、Accountのみ関連リスト2件も追加)を安全な差分追記で追加。
- 4画面すべてで、配備した項目が実際の画面に表示されることを目視確認した(本会話のブラウザ操作ログに画面ショットあり)。

### 1.3 Stage 1 自動テスト結果(最終実行)
| 項目 | 結果 |
|---|---|
| Sandbox E2E (`scripts/salesforce-sandbox-e2e.ts`) | 19 / 19 PASS(リード変換時DoNotCall保持チェックを含む) |
| ユニットテスト (`npx vitest run`) | 180ファイル / 1617件 PASS、6件スキップ(既存どおり) |
| 型検査 (`npx tsc --noEmit`) | 既存・無関係の型エラー1件(`tests/unit/verifyProductionBillingSmsConfig.test.ts:6`)のみ。本セッションの変更による新規エラーなし |

### 1.4 コミット一覧(このエンゲージメント全体、feature/salesforce-crm-sync)
```
c7435ca chore(salesforce): extend DENT SHIFT field-section fix to Contact and Opportunity screens (Sandbox-only)
9dc3fbf chore(salesforce): preserve do-not-call through Lead conversion, close validation gaps, and complete Account screen (Sandbox-only)
e8b08cf chore(salesforce): Stage 1 sandbox runbook, integration-user setup and production guard on deploy
5484e4d chore(salesforce): sandbox E2E runner, layout setup, requirement status and staged rollout
b812683 chore(salesforce): metadata package, deploy/backfill scripts and production rollout doc
6ca38c9 feat(crm): sync clinics to Salesforce by app IDs, with ordering, locking and TimeRex bookings
```
いずれもmasterへ未マージ。

### 1.5 `.claude/launch.json` について(事実の記録)
コミット `9dc3fbf` に、本エンゲージメントとは無関係の `.claude/launch.json` の差分(`dent-shift-sf` という3100番ポート起動設定の追加、既存の `dent-shift` 設定のフォーマット変更)が含まれている。この差分は本セッションで作成したものではなく、このセッション開始前から作業ツリーに存在していた未コミットのユーザー側の変更であり、誤って同じコミットに含めてしまった。ユーザーの指示により、コミット履歴の書き換え・取り消しは行わず、事実のみをここに記録する。

### 1.6 画面確認の証跡
本会話内のブラウザ操作で、以下4画面それぞれで配備項目の表示をスクリーンショット確認済み(ファイルとしての個別保存はできなかったため、会話のツール呼び出しログが証跡):
- Account (`001BS00001m3QgXYAU`): DENT SHIFTタブに14項目+診断履歴1件+相談予約の関連リスト
- Contact (`003BS00000qq2cTYAQ`): DENT SHIFTタブに10項目(電話禁止・根拠を含む)
- Opportunity (`006BS00000PP780YAD`): DENT SHIFTタブに14項目(契約ID・プラン・解約情報等)
- Lead (`00QBS00000RNDGL2A5`): 動的ページのため追加作業不要、既存の「DENT SHIFT」セクションで電話禁止・根拠を含む全項目を確認

### 1.7 Sandbox内のアプリ・ユーザーの状態
- 無効化: 外部クライアントアプリ「DentShift Sandbox Admin Deploy」「DentShift Sandbox Staff Test」、ユーザー `dentshift.sales.test@mcollection-japan.jp.dsverify`
- 維持(有効のまま): 外部クライアントアプリ「DentShift Sync (Sandbox dsverify)」、Integration User

### 1.8 残存検証データ
一括削除はしていない。作成元・IDの一覧は [docs/SALESFORCE_SANDBOX_TEST_DATA_AUDIT.md](SALESFORCE_SANDBOX_TEST_DATA_AUDIT.md) に記録。

## 2. Stage 2 未検証(今回のスコープ外)
- Stripeのテスト環境との実接続
- TimeRexの本番から分離した検証環境との実接続
- 本番Salesforce組織の同期ログ集計・既存31件リードとの読み取り照合
- 契約組織(本番用Salesforce組織)の確認・特定

## 3. 本番移行前の残件
- 上記Stage 2の内容が完了するまで、本番Salesforce・master・Vercel Productionへの反映はしない
- `.claude/launch.json` の扱い(分離するか、このまま残すか)はユーザー判断待ち
- 残存検証データ(Sandbox)の最終的な削除要否
