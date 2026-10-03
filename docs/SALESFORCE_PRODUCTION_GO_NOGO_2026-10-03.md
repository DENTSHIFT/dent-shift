# Salesforce連携 本番有効化 Go/No-Go 判断材料

作成日: 2026-10-03
作成者: PO依頼によりClaude Codeが作成(ドキュメントのみ。Salesforce・本番DBへの接続・書き込みは一切行っていない)
対象ブランチ: `feature/salesforce-crm-sync`

> 本書は読み取り専用調査(リポジトリ内のコードと既存docsの閲覧)に基づく。
> 前提として引き継ぐPO判断(変更しない):
> - **allowSaveの競合リスクはSandbox検証に限り許容。本番適用は未承認。**(`docs/SALESFORCE_ALLOWSAVE_ALTERNATIVES_2026-10-03.md`)
> - **初期運用はLead→Contact/Accountの手動変換を第一候補とする。実際の変換実行はまだ未承認。**(`docs/SALESFORCE_LEAD_MANUAL_CONVERSION_PROCEDURE_2026-10-03.md`)
> - **TimeRexの医院紐付け・日程変更後の維持は本番有効化前の必須条件。**(`docs/PRODUCTION_MIGRATION_PLAN_2026-10-03.md` 4.2c節)— 本書作成時点で**未解決(TimeRexサポート回答待ち)**。完了扱いにしない。

根拠にした実装: `src/server/services/salesforceSync.ts`(`pushSnapshotToSalesforce` / `upsertContactAllowingOwnLeadDuplicate` / `adoptConvertedRecord` / `syncIntegrationEvent` / `recordFailure` / `retryPendingIntegrationEvents`)、`src/server/db/crmSyncLockRepository.ts`、`vercel.json`(Cron設定)、`src/server/config/salesforceConfig.ts`。

---

## 0. 結論(先に要点)

| 問い | 結論 |
|---|---|
| 手動変換でallowSave分岐の発生頻度は下がるか | **下がる**(未コンバートLeadが減れば、Contact upsertがLeadと衝突する機会が減る)。ただし**ゼロにはならない**(1章)。 |
| 未変換Leadとの衝突は通常フローに残るか | **残る**。診断(Lead作成)→会員登録(Contact upsert)の間に人が変換を済ませる保証がないため、初回のContact upsertでDUPLICATES_DETECTEDが起きる経路は手動変換の有無に関係なく存在する(2章)。 |
| 今すぐ本番有効化できるか | **No-Go**。3章の必須条件のうち、少なくともTimeRex紐付け(PO確定の必須条件、未解決)、allowSave本番適用の承認、本番組織ID照合、連携ユーザー最小権限化、DoNotCall保持Flowの本番反映確認、本番組織の重複ルール設定確認が未充足。 |

---

## 1. allowSaveの残存リスクを手動変換でどこまで減らせるか

### 1.1 allowSave分岐に入る条件(実装)

`upsertContactAllowingOwnLeadDuplicate`(`salesforceSync.ts` L348-412)は次の順で動く。

1. Contactを外部ID(`DentShift_User_Id__c`)でupsert(`includeDuplicateRecordDetails: true`)。
2. `DUPLICATES_DETECTED`以外のエラーはそのまま投げる(allowSaveは使わない)。
3. `DUPLICATES_DETECTED`のとき、候補一覧が空なら投げる。
4. 自医院のLead(`DentShift_Clinic_Id__c = clinic.id`)を読み、**`IsConverted === false` かつ Emailが今回のContactと一致**し、**候補の全件がそのLeadのID**であるときだけ`allowDuplicateSave: true`で再送する。
5. それ以外はすべて投げる(運用画面で「要確認」として残る)。

つまりallowSave分岐に入る前提は「**自医院の未コンバートLeadがSalesforce上に存在すること**」である。手動変換でこのLeadを`IsConverted = true`にすると、手順4の条件`IsConverted === false`を満たさなくなり、分岐には入らない。さらに、変換済みLeadはSalesforce標準の「Standard Rule for Contacts with Duplicate Leads」の候補にも通常ならないため、手順1のupsertが`DUPLICATES_DETECTED`にならず、そもそも分岐に到達しない。

### 1.2 手動変換で減らせる範囲

- 変換済みの医院: `readConvertedLead`が`IsConverted = true`を返し、`pushSnapshotToSalesforce`は`adoptConvertedRecord`経路(1.3参照)に入る。Lead upsertは行わず(L449: `!converted && !hasAccount`)、Contact upsertはコンバート先Contactに外部IDを引き継いだ後に通常upsertとなる。**この医院ではallowSave分岐に入らない。**
- 結果として、未コンバートLeadの滞留数が減るほど、allowSave分岐に入る「候補の母数」が減る。頻度の低減効果は、手動変換の運用速度(Lead作成から変換までの時間)に比例する。

### 1.3 ゼロにならない理由(実装上の根拠)

1. **新規Leadは連携が作り続ける。** 診断のみの医院(`hasAccount = false`、L445)では毎回の同期でLeadをupsertする(L449-463)。手動変換はこのLead作成を止める手段ではない。
2. **Lead作成からContact upsertまでの時間差は人の作業速度に依存する。** 同じ医院が診断の直後に会員登録すると、`contacts.length > 0`で`hasAccount = true`となり、同じ回の同期でAccount upsert(L500-507)とContact upsert(L508-516)が走る。この時点で未コンバートLeadが残っていれば、同一EmailのLeadとして重複ルールに検出され、allowSave分岐に入る。**この間隔は数分〜数時間になり得るが、手動変換は営業時間内の人の操作であり、時間差をゼロにできない。**
3. **2026-10-03修正(L438-444)は衝突の「繰り返し」を減らすだけ。** `hasAccount = true`の医院でLeadを再upsertしないよう修正されたが、診断段階で作られた既存Leadを消す・変換するわけではない。初回のContact upsert時の衝突は残る。
4. **TOCTOUそのものは変わらない。** allowSave分岐に入った後の2回目のリクエストで評価される重複集合を固定できないというAPI上の制約(L336-346のコメント、`SALESFORCE_ALLOWSAVE_ALTERNATIVES` 1.2節)は、手動変換の有無と無関係に残る。手動変換は「分岐に入る回数」を減らすが、「分岐に入った1回あたりのリスク」は減らさない。

### 1.4 手動変換が移すリスク(新たに意識すべき点)

変換後は`adoptConvertedRecord`(L275-318)が走り、次の場合に`PermanentSyncError`(`converted_lead_conflict`)で**即時に上限到達扱い**(`recordFailure`で`retryCount = MAX_RETRY_COUNT`、`nextRetryAt = null`、通知送信)になる。

- コンバート先とは別のAccount/Contact/Opportunityが同じ外部IDを既に持っている。
- コンバート先に別の外部IDが設定済み。
- コンバート先レコードが見つからない。

これらは自動統合しない設計(安全側)だが、手動変換の際に外部ID一致しない既存Account/Contactを選ぶと、変換した医院の同期がその場で止まる。手順書6章チェックリスト(外部ID一致の確認)を守ることが、allowSave低減の裏側にある前提条件になる。

---

## 2. 未変換Leadとの衝突が通常フローに残るか

**残る。** 根拠は以下。

### 2.1 衝突が起きる経路

`pushSnapshotToSalesforce`の書き込み順と、DUPLICATES_DETECTEDの扱いは次の通り。

| 順 | 対象 | 関数 | DUPLICATES_DETECTED時の挙動 |
|---|---|---|---|
| 1 | Lead(診断のみの医院) | `upsert`(L431-434) | **再送しない**。そのまま失敗→指数バックオフ再試行(上限8回)。 |
| 1' | 変換済み医院の外部ID引き継ぎ | `adoptConvertedRecord` | 重複ルールの対象外(IDでの部分更新)。外部ID衝突は`PermanentSyncError`。 |
| 2 | Account | `upsert` | **再送しない**。失敗→再試行。 |
| 2 | **Contact(全contacts分)** | **`upsertContactAllowingOwnLeadDuplicate`** | **ここだけ**自医院の未コンバートLeadとの衝突に限りallowSave再送。 |
| 3 | Opportunity | `upsert` | 再送しない。 |
| 4 | 診断履歴・相談予約 | `upsert` | 再送しない。 |

**衝突が「通常フロー」で起きるのは順2のContact upsert**であり、トリガーは「同じ医院・同じEmailの未コンバートLeadがSalesforce上にあること」。これは診断→会員登録という本サービスの標準導線そのものから生まれる状態である。

### 2.2 手動変換の有無による違い

| 状況 | 衝突の発生 | 挙動 |
|---|---|---|
| 変換前(未コンバートLeadあり)・同一Email | **起きる** | allowSave分岐。条件を満たせば再送して成功。満たさなければ失敗→再試行→最大8回で上限到達・通知。 |
| 変換前・Email不一致(例: 診断時の連絡先と登録メールが違う) | 起きない、または候補が別オブジェクト | 重複ルールが検出しなければ通常成功。検出して候補が自医院Leadでなければ失敗(allowSaveは使わない)。 |
| 変換後(`IsConverted = true`) | **起きない** | `adoptConvertedRecord`→通常upsert。allowSave分岐に入らない。 |
| 変換後だが外部ID不整合 | 別種の停止 | `converted_lead_conflict`で即時「要確認」。 |

結論: 手動変換は「変換後」の行を増やすことで衝突回数を減らすが、「変換前」の行を消すことはできない。**衝突は通常フローに残る**。本番でallowSave分岐を一切踏ませたくない場合は、代替案A(`SALESFORCE_ALLOWSAVE_ALTERNATIVES` 2章)を実装・Sandbox検証するか、衝突時は常に失敗させて要確認キューに回す(同3章「参考・不採用」案)運用に切り替える判断が必要になる。本書ではその判断を行わない。

### 2.3 失敗した場合の再試行の実際の時間感覚

- 衝突で失敗したイベントは`recordFailure`で`status = failed`、`retryCount + 1`、`nextRetryAt = now + 2^retryCount秒`(上限30分)。
- 再試行の実行契機はVercel Cron `/api/internal/salesforce/retry`(`vercel.json`: 15分おき)と、運用画面からの手動再送のみ。バックオフは最初の数回は秒〜分単位だが、実際の再試行間隔はCron周期(15分)に律速される。
- したがって、衝突原因が解消されないまま放置すると、**約2時間(8回 × 15分)で上限到達**し、`notifySalesforceSyncFailure`が1回だけ通知される(`alertedAt`で重複通知を抑止)。手動変換を「上限到達前」に行えば、次の再試行で変換後の経路に入り成功する。

---

## 3. 移行前必須条件

`PRODUCTION_MIGRATION_PLAN_2026-10-03.md` 3章(11項目)・4章(4.1/4.2a/4.2b/4.2c/4.3)の未決事項は**すべて未充足のまま**であり、本書はそれを再掲しない。以下は、それらに加えて、**`SALESFORCE_PROVIDER`を本番で`salesforce`に切り替える直前**に満たすべき条件を、Salesforce連携固有のものに絞って列挙する。

| # | 条件 | 現状 | 根拠・参照 |
|---|---|---|---|
| S1 | **TimeRexの医院紐付け・日程変更後の紐付け維持が確認済み** | **未解決(サポート回答待ち)。完了扱いにしない。** | PO確定の必須条件。`PRODUCTION_MIGRATION_PLAN` 4.1/4.2c、`TIMEREX_URL_PARAMS_INVESTIGATION_2026-10-03.md` |
| S2 | **allowSave方式の本番適用についてPOの明示承認**、または代替案への切替完了 | 未承認(Sandbox限定許容のみ) | `SALESFORCE_ALLOWSAVE_ALTERNATIVES` 冒頭PO前提。本書1-2章の「衝突は残る」を理解したうえでの判断が必要 |
| S3 | 本番Salesforce組織IDの同一性照合完了、`SALESFORCE_EXPECTED_ORG_ID`に照合済みの値を設定 | 未完了 | `PRODUCTION_MIGRATION_PLAN` 3章#4、`SALESFORCE_PRODUCTION_ROLLOUT.md` 1章。不一致時は`ORG_MISMATCH`で書き込み前に停止する設計(`isConnectionLevelError`) |
| S4 | 連携ユーザーが専用Integration User(最小権限)に切替済み | 未完了(現状システム管理者) | `PRODUCTION_MIGRATION_PLAN` 3章#5 |
| S5 | 本番組織の重複ルール・マッチングルール設定の確認(「Contacts with Duplicate Leads」が有効か、アクションがブロックか警告か) | **未確認**(リポジトリ内にメタデータなし) | `SALESFORCE_LEAD_MANUAL_CONVERSION_PROCEDURE` 7章。設定次第で1-2章の衝突挙動自体が変わるため、有効化前に把握が必要 |
| S6 | `DentShift_Preserve_Do_Not_Call_On_Convert` Flowの本番組織反映とActiveバージョンの確認 | **Sandboxは確認済み**(V1有効、転記先=Contactカスタム項目`DentShift_Do_Not_Call__c`。既存Contact=false+Lead=trueの実変換でfalse→trueになり架電対象リストから外れることを実測(ドライラン計画10.5)。この組織に標準`DoNotCall`は存在しない)。**本番組織は未確認** | 同手順書 8.7.2/8.8節 |
| S6b | 手動変換で「取引先を新規作成」した場合に新規Accountの`DentShift_Clinic_Id__c`が空になる問題への対処決定(既存Account選択の徹底、変換直後の人手入力、または対応付け設定変更のいずれか) | **未決**(Sandboxドライランで判明) | 同手順書 8.8節、ドライラン計画 10.3節 |
| S7 | 手動変換の担当者が決まり、その人がConvert Leads権限を持つことを確認 | **担当者未決**。Sandboxではシステム管理者・標準ユーザー両プロファイルで「リードの取引の開始」有効を確認。ただし営業担当(Sandbox)検証ユーザーは無効化状態。本番は未確認 | 同手順書 8.7.1節 |
| S8 | 本番既存Lead 37件の扱い決定(手動変換対象リスト、外部ID未設定31件は個別確認扱い) | **未着手(照合は保留)**。本番Salesforce/本番DBの読み取りはこのセッションの自動権限判定で拒否されるため、本人実行用の読み取り専用スクリプト `scripts/salesforce-lead-clinic-match-readonly.ts` を用意した(一意一致/候補複数/一致なし/情報不足の件数とIDのみ出力、個人情報なし。組織ID不一致で照会前に停止、`--expect-db-host`とDATABASE_URLのホスト名不一致でDB接続前に停止。秘密値はファイルを`source`して渡し、コマンド行に書かない)。実行はPO本人 | 同手順書 7章・8.3節運用ルール、`SALESFORCE_PRODUCTION_LEAD_READONLY_CHECK.md` |
| S9 | `/ops/integration-events`と`/api/ops/salesforce-connection-check`が本番で管理者のみアクセス可能であることの確認 | 要確認 | 4章・6章の手順がこれらに依存する |
| S10 | 本番用DBが新規作成され、`IntegrationEvent`・`CrmSyncLock`テーブルがマイグレーション済み | 未完了 | `PRODUCTION_MIGRATION_PLAN` 3章#8、5章手順7 |
| S11 | 5章の停止条件と6章の復旧手順について、監視担当者と停止権限者が決まっている | 未決 | 監視はログ目視のみ(`PRODUCTION_MIGRATION_PLAN` 7章) |

S1〜S11のいずれか1つでも未充足なら**No-Go**とする。特にS1はPO判断で必須条件と確定しており、「運用フォールバック(メール完全一致)があるから許容」という判断は本書では行わない。

---

## 4. 切替手順(`SALESFORCE_PROVIDER`本番有効化)

**注意**: 以下は手順の整理であり、3章がすべて充足し、`SALESFORCE_PRODUCTION_ROLLOUT.md`の段階Cの個別承認を得てからのみ実施する。本セッションでは一切実施していない。

### 4.1 事前バックアップ
1. 本番Salesforce: 対象オブジェクト(Lead/Account/Contact/Opportunity)のデータエクスポート(Setup > データのエクスポート、または管理者権限でのレポートエクスポート)を取得し、取得日時と件数を記録する。連携ユーザーの資格情報は使わない。
2. 本番DB: `IntegrationEvent`の`status`別件数と`CrmSyncLock`の件数(0件であること)を記録する。
3. 現在のVercel本番環境変数(`SALESFORCE_*`)の値を記録する(`SALESFORCE_PROVIDER=disabled`であることを確認)。

### 4.2 読み取り確認(`disabled`のまま)
1. `SALESFORCE_PROVIDER=disabled`のまま、`SALESFORCE_CLIENT_ID`/`SALESFORCE_CLIENT_SECRET`/`SALESFORCE_LOGIN_URL`/`SALESFORCE_EXPECTED_ORG_ID`を本番値で設定する。`resolveSalesforceConfig`は`disabled`なら接続しないため、この段階で同期は走らない。
2. `/api/ops/salesforce-connection-check`(`parseSalesforceCredentials`経由の読み取り専用診断)で、認証成功・接続先組織IDが`SALESFORCE_EXPECTED_ORG_ID`と一致することを確認する。不一致なら中止する。
3. 本番組織に外部ID項目(`DentShift_Clinic_Id__c` / `DentShift_User_Id__c` / `DentShift_Subscription_Id__c` 等)が存在することを確認する(メタデータ未デプロイなら`scripts/salesforce-metadata-deploy.mjs`の実行承認が別途必要)。
4. `IntegrationEvent`で`status in (pending, failed)`かつ`retryCount < 8`の行数を確認する。**有効化した瞬間、これらが最初のCronで最大50件ずつ送られる**(`retryPendingIntegrationEvents(limit = 50)`)。本番DBが新規なら0件のはずで、0件でなければ内容を確認してから進む。

### 4.3 有効化
1. `SALESFORCE_PROVIDER=salesforce`に変更し、再デプロイする(環境変数は再デプロイで反映)。
2. 直後に`/api/ops/salesforce-connection-check`を再実行し、組織ID一致を再確認する。

### 4.4 初回同期の監視(有効化後24〜48時間)
| タイミング | 確認内容 | 正常の目安 |
|---|---|---|
| 有効化後15分以内(初回Cron) | Vercel Function Logsで`/api/internal/salesforce/retry`の実行結果。`stoppedReason: "connection_error"`が出ていないこと | `attempted`がpending件数と一致、エラーなし |
| 最初の新規診断1件 | `IntegrationEvent`が`synced`になり、`externalId`にLead IDが入る。Salesforce上でLeadが1件だけ作られ、`DentShift_Clinic_Id__c`が入っている | Account/Contactは作られない(`hasAccount = false`) |
| 最初の会員登録1件 | Account 1件・Contact 1件が作られる。`lastError`に`DUPLICATES_DETECTED`が出た場合、次の再試行で`synced`になるか、または5章の停止条件に該当するか判定する | 同一医院のLeadが未変換ならallowSave分岐を1回踏む(2章)。これは想定内だが記録する |
| 1時間ごと(初日) | `IntegrationEvent`の`failed`行数、`retryCount >= 8`行数、`lastError`の種類別件数 | `retryCount >= 8`が0件 |
| `CrmSyncLock` | `lockedUntil`が現在時刻より3分以上過去の行が残っていないこと | 残骸があれば異常終了した同期がある |

---

## 5. 停止条件(即座に`disabled`へ戻す事象)

閾値は、実装の再試行・ロック機構を根拠に次のように提案する。**「要確認で止まる」設計の停止(`PermanentSyncError`)と「想定外の書き込み」を区別し、後者は1件でも停止する。**

| # | 事象 | 閾値 | 根拠 |
|---|---|---|---|
| T1 | **意図しないレコード作成** | **1件でも** | 自動削除しない設計(6章)のため、件数が増える前に止める。具体例: `hasAccount = true`の医院にLeadが新規作成される(L449の条件に反する)、`subscriptions`が0件の医院にOpportunityが作られる、外部ID項目が空のLead/Contact/Accountが連携ユーザーによって作られる、同一外部IDのレコードが2件以上できる |
| T2 | **別医院・別オブジェクトとの重複をallowSaveで保存した疑い** | **1件でも** | 1.3節のTOCTOU制約。Contact upsertの`DUPLICATES_DETECTED`後に成功したイベントについて、Salesforce上でContactが「自医院のLead以外」とマージ・紐付けされていないか確認し、疑いがあれば停止 |
| T3 | **`DUPLICATES_DETECTED`の連続** | 同一Cron周期(15分)内に**異なる医院3件以上**で発生、または**Contact以外**(Lead/Account/Opportunity)で**1件でも**発生 | Contact以外にはallowSave救済がなく(2.1節)、再試行しても同じ理由で失敗して8回で上限到達する。複数医院で同時発生は重複ルール設定の想定違い(S5未確認)を示唆 |
| T4 | **`retryCount >= 8`(上限到達)の蓄積** | 有効化後24時間以内に**`converted_lead_conflict`・`no_clinic_id`・`clinic_not_found`以外の理由**で**1件でも**上限到達、または理由を問わず**3件以上** | `recordFailure`で永続エラーは即上限、通常エラーは約2時間で上限(2.3節)。永続エラー3種は「要確認」設計で想定内だが、それ以外の上限到達は未知の失敗 |
| T5 | **接続レベルエラー** | `ORG_MISMATCH`または`OAUTH`が**1回でも** | `isConnectionLevelError`で書き込み前に止まり、15分後に再試行する設計のため実害は出ないが、設定ミスか資格情報失効であり、原因確認まで`disabled`に戻して再試行を止める |
| T6 | **ロックの滞留** | 同一医院で`busy`が**3回連続**(= 約45分、Cron 3周期)、または`lockedUntil`が**3分(リース1回分)を超えて過去**の`CrmSyncLock`行が複数医院で残る | リース3分(`CRM_SYNC_LOCK_LEASE_MS`)、`busy`時は30秒後に再試行予約。期限切れロックは次の同期が引き継ぐ設計なので1件の残骸は正常範囲。複数医院で残るのは関数の異常終了が繰り返されている兆候 |
| T7 | **`failed`比率** | 1回のCronで`attempted`のうち**半数以上**が`failed`、または`synced`が**連続2周期ゼロ**なのに`pending`が減らない | `retryPendingIntegrationEvents`は1回最大50件。失敗が過半なら個別事象ではなく環境差(項目未作成・権限不足)の可能性 |

停止操作: Vercelで`SALESFORCE_PROVIDER=disabled`に変更して再デプロイ(`SALESFORCE_PRODUCTION_ROLLOUT.md` 6章)。`syncIntegrationEvent`は`"disabled"`を返して即終了し、`retryPendingIntegrationEvents`も`attempted: 0`で終了する。進行中の同期は再デプロイで中断されるが、`beforeWrite`でロック更新を行う設計のため、中断後の残骸ロックは3分で期限切れになる。

---

## 6. 復旧方法(`disabled`へ戻した後)

### 6.1 `IntegrationEvent`のpending/failed行の扱い

`disabled`中は`syncIntegrationEvent`が行を一切触らないため、状態は停止時点で凍結される。再有効化前に次の区分で判断する。

| 区分 | 条件 | 推奨 |
|---|---|---|
| A. 自動再試行対象 | `status in (pending, failed)` かつ `retryCount < 8` | 原因(5章T*)を解消したうえで再有効化すれば、次のCronで自動送信される(`SALESFORCE_PRODUCTION_ROLLOUT.md` 6章「試行回数は消費しない」)。**再有効化=この全件が送られる**ことを認識し、4.2節手順4と同様に件数を先に確認する |
| B. 上限到達(永続エラー3種) | `retryCount >= 8` かつ `lastError`が`converted_lead_conflict` / `no_clinic_id` / `clinic_not_found` | 設計上の「要確認」。Salesforce側の外部ID不整合や医院欠落を人が解消した後、`/ops/integration-events`から理由を記入して個別再送(`/api/ops/integration-events/[id]/retry`)。解消できない場合は再送しない |
| C. 上限到達(その他) | `retryCount >= 8` かつ上記以外 | 原因不明の失敗。再送前に`lastError`を1件ずつ確認し、環境差(項目未作成・権限)なら解消後に一括再送(`/api/ops/integration-events/bulk-retry`、理由必須)。再送しても同じ内容が同期時点のDBスナップショットから再構築される(冪等設計、L85-86)ため、**再送による二重作成は外部IDが同じ限り起きない** |
| D. 破棄 | 対象医院がテストデータ・削除済み・同期不要と判断されたもの | **破棄専用の操作はリポジトリ内に見つからなかった**(運用画面には再送機能のみ確認)。破棄が必要な場合は、`status`を変更する手段(DB直接更新)の承認を別途取る。それまでは`retryCount >= 8`のまま放置すればCronの対象外(`retryCount < MAX_RETRY_COUNT`条件)で、再有効化しても送られない |

**停止中に新たに発生したイベント**(診断・登録・Stripe Webhookは`disabled`でもDBに`pending`で蓄積される)は区分Aに含まれる。長期間停止すると再有効化時の初回送信量が増える点に注意する。

### 6.2 誤作成されたSalesforceレコードの扱い

- **自動削除はしない。** 連携コードに削除経路は存在せず、追加もしない。
- 個別確認: 5章T1/T2で停止した場合、停止時刻以降に連携ユーザーが作成・更新したレコードを、Salesforce側の「作成者」「最終更新者」で絞り込み、1件ずつ人が判断する(手順書6章のチェックリストを流用)。
- 削除する場合: 管理者権限を持つ人がSalesforce画面で実施する。**外部IDを持つレコードを削除しても、原因未解消のまま再有効化すると同じ外部IDで再作成される**(upsertの冪等性)。削除より先に原因解消(S5の重複ルール設定、コード修正、データ修正のいずれか)を確定させる。
- 残す場合: 外部IDが正しければ、そのレコードは以後の同期で正しく更新され続ける。外部IDが誤っている場合は`adoptConvertedRecord`と同じ考え方で**値を書き換えて辻褄を合わせることはしない**(手順書6章#7)。要確認として記録し、PO判断を仰ぐ。
- 誤マージ(T2)の場合: Salesforceのマージは標準機能では元に戻せないため、4.1節のバックアップから該当レコードの値を人が復元する。この復元作業の手順は本書では定めない(発生時に個別計画が必要)。

### 6.3 再有効化の判断

再有効化は、(1) 停止原因の特定と解消、(2) 6.1節の区分A件数の確認、(3) 6.2節の個別確認完了、の3点が揃ってから、4章の手順を最初からやり直す。段階的に戻す仕組み(医院単位の有効化など)はコードに存在しないため、再有効化は全医院一斉になる。

---

## 7. 本書で決めていないこと

- allowSave方式を本番で使うか、代替案Aに切り替えるか(S2)。本書は「衝突は残る」という事実の整理に留まる。
- 停止条件T3/T4/T6/T7の閾値の最終値。実装の定数(リース3分、Cron15分、上限8回、1回50件)から導いた提案であり、本番のイベント量が分かるまでは暫定とする。
- 区分D(破棄)の操作手段。
- `INCIDENT_RUNBOOK.md`への統合(現状、Salesforce固有の停止・復旧は`SALESFORCE_PRODUCTION_ROLLOUT.md` 6章と本書に分散している)。
