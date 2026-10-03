# DENT SHIFT × Salesforce Lead手動変換 手順書(初期運用)

作成: 2026-10-03 / 対象ブランチ: `feature/salesforce-crm-sync`
作成者: PO依頼によりClaude Codeが作成(手順書のみ。Salesforceへの変換操作・自動化実装は行っていない)

> 本書は「初期運用はLead→Contact/Account変換を人が画面上で判断して実行する(手動変換)」とした場合の、担当者向け操作手順書である。
> 変換の実行・自動化実装(Apex/Flow等による自動変換)はこの文書の対象外。`docs/PRODUCTION_MIGRATION_PLAN_2026-10-03.md` 4.2a節・4.2b節の「Lead運用方針」「医院重複統合の要否」自体の最終決定は、本書では行わない(未決のまま、判断に必要な材料のみ整理する)。
> 本書の記載は `src/server/services/salesforceSync.ts`、`src/domain/integration/salesforceCrmMapping.ts`、`src/server/providers/salesforce/salesforceClient.ts`、`salesforce/force-app/main/default/flows/DentShift_Preserve_Do_Not_Call_On_Convert.flow-meta.xml`、および `docs/SALESFORCE_CRM_FIELD_SPEC.md` 等の既存ドキュメントを読んだ内容に基づく。想定・推測は「未確認」「未決定」と明記する。

> **採用状況(2026-10-03、PO判断)**: 本手順は「初期運用の候補」として採用された。**本番運用の開始・実際のLead変換の実行はまだ承認されていない。** 以下は実行前に確認・決定すべき未確認事項として明示的に残す:
> - 所有者(Owner)割当ルール(新規Lead/既存Accountの所有者をどちらに揃えるか)は未決定。
> - DoNotCall保持Flowの本番組織への反映有無は未確認(現状Sandbox限定での存在のみ確認済み)。
> - 既存Account/Contactの選択条件(外部IDが見つからない場合に、どの基準で「既存候補とみなす」か)は、本書のチェックリスト(6節)以上には踏み込んでおらず、Salesforce標準の重複ルール・マッチングルールとの整合は未確認。

---

## 0. 前提: 自動連携との関係

- DENT SHIFTの自動連携(`salesforceSync.ts`)は、Lead/Account/ContactをすべてDENT SHIFT側の外部ID(`DentShift_Clinic_Id__c` / `DentShift_User_Id__c`)でupsertするだけで、**Lead→Contact/Accountの変換自体は行わない**。変換後は、コンバート先のAccount/Contact/Opportunityへ外部IDを設定して以後の更新を続ける(`adoptConvertedRecord`)。
- つまり「誰かが変換を実行する」ことが前提の設計であり、自動連携は変換の代わりにはならない。本書の手動変換は、その「変換を実行する人」の操作手順を定める。
- Contact upsert時の重複対応(`upsertContactAllowingOwnLeadDuplicate`、allowSaveによる限定的な再送)は、**自医院・同一メールの未コンバートLeadと衝突した場合だけの救済策**であり、変換そのものの判断ロジックではない。この仕組みが働かない(候補が取得できない/自医院以外のLeadが混ざる等)ケースは同期がエラーで停止し、運用画面に「要確認」として残る。手動変換はこの「自動連携が機能しない、または判断を自動化できていないケース」の受け皿であり、`DentShift_Site_Domain__c` を使った重複ルール・レポートでの確認運用(`SALESFORCE_PRODUCTION_ROLLOUT.md` 3章で提案中・未決定)とあわせて使う。
- 本書は手動変換の**手順**を定めるものであり、`docs/SALESFORCE_ALLOWSAVE_ALTERNATIVES_2026-10-03.md` が検討している自動化実装の要否(allowSave継続か代替案か)には踏み込まない。

---

## 1. 外部IDで既存Account/Contactを選ぶ方法

### 1.1 使用する外部ID項目(既存コードに基づく)

| オブジェクト | 外部ID項目API名 | 用途 |
|---|---|---|
| Lead | `DentShift_Clinic_Id__c` | DENT SHIFTの医院ID |
| Account | `DentShift_Clinic_Id__c` | 同上(会員登録済みの医院) |
| Contact | `DentShift_User_Id__c` | DENT SHIFTのユーザーID |

`salesforceCrmMapping.ts` のコメントに明記の通り、**メールアドレスでは医院を統合しない**。Lead変換時の既存Account/Contact選択でも、メール一致だけを根拠にしない。

### 1.2 変換前の確認手順

1. 対象LeadのレコードページでLead詳細を開き、以下を確認する。
   - `DentShift_Clinic_Id__c`(医院ID)の値を控える。
   - `DentShift_Site_Domain__c`(サイトのドメイン)を確認する(医院の同一性確認の補助情報。重複ルール・レポートでの確認運用は `SALESFORCE_PRODUCTION_ROLLOUT.md` 3章で提案中・未決定だが、手動確認では利用できる)。
   - 会社名・URL・電話番号など、画面に表示されている通常項目も合わせて確認する。
2. Salesforceの検索(グローバル検索、または取引先の一覧でのフィルタ)で、`DentShift_Clinic_Id__c` に**同じ値**を持つ既存Accountがないか検索する。
   - 同じ値のAccountが見つかった場合: そのAccountを変換先として選択する(新規Account作成は選ばない)。
   - 見つからない場合: 新規Account作成を選ぶ(2.3節の確認を先に行う)。
3. 取引先責任者(Contact)についても同様に、`DentShift_User_Id__c` が一致する既存Contactを検索する。
   - 一致するContactが見つかった場合はそのContactを選択する。
   - 見つからない場合のみ新規Contact作成を選ぶ。
4. 標準のLead変換画面(「取引開始(Convert)」ボタンから開く画面)では、「既存の取引先を選択」「既存の取引先責任者を選択」のドロップダウンに検索候補が表示される。**候補の選択は必ず1.2の外部ID確認(手順2・3)を済ませてから行う**。画面の候補一覧が会社名・氏名の類似度で表示するだけであり、外部IDの一致を保証しないため、候補に出てきたというだけで選ばない。
5. 外部ID(`DentShift_Clinic_Id__c` / `DentShift_User_Id__c`)が一致する既存レコードが見つかった場合、変換後にその項目の値を書き換えない(自動連携が継続して使う外部IDのため)。

---

## 2. 電話禁止(Do Not Call)の保持

- このSalesforce組織には標準の `DoNotCall` 項目が存在しないため、Sandbox限定の代替カスタム項目 `DentShift_Do_Not_Call__c`(Lead/Contact)が使われている(新規作成時の既定値はtrue)。
- 変換時の自動保持ロジックとして、Flow `DentShift_Preserve_Do_Not_Call_On_Convert`(`salesforce/force-app/main/default/flows/DentShift_Preserve_Do_Not_Call_On_Convert.flow-meta.xml`)が用意されている。**ただしこのFlowの説明欄に明記の通り、現時点ではSandbox dsverify限定**であり、本番組織への反映状況は本書の調査範囲(リポジトリ内ファイル)からは確認できない。
- Flowの動作: Leadの `DentShift_Do_Not_Call__c` がtrueの状態で変換された場合、変換先Contactの同項目をtrueにする(true→falseの意図しない解除は行わない一方向ロジック)。
- 手動変換時の確認手順:
  1. 変換前にLeadの `DentShift_Do_Not_Call__c` の値を確認する。
  2. 変換後、変換先Contactの `DentShift_Do_Not_Call__c` を確認する。Leadがtrueだったのに変換先Contactがfalseのままの場合は、**Flowが対象組織で有効化されていない可能性がある**ため、変換を一旦保留し、担当者自身の判断で項目を手動更新する前に、Flowの有効化状況を確認する(本書では確認方法の提示に留め、確認作業自体は本書の対象外)。
  3. 既存Contact(1章で選択したもの)が既にtrueの場合、変換によってfalseに書き換わっていないことも必ず確認する(Flowはtrueを設定するのみで、既存の手動設定を上書きしない設計だが、Flow未反映の環境では保証されない)。

---

## 3. 所有者(Owner)の保持

- `SALESFORCE_PRODUCTION_ROLLOUT.md` 3章に「担当営業(所有者)の手動変更は上書きしない」との方針記載があるが、新規Lead作成時に誰が所有者になるかという割当ルールの明文化はリポジトリ内に見つからなかった(`docs/PRODUCTION_MIGRATION_PLAN_2026-10-03.md` 4.2a節に同様の指摘あり、未決事項)。
- 手動変換時の確認手順:
  1. 標準のLead変換画面には「レコード所有者」の指定欄がある。既定では変換対象Leadの現在の所有者が引き継がれる。
  2. 既存Account/Contactを選択する変換の場合、既存レコードの所有者と変換後の所有者が異なる組み合わせになり得る(例: 既存Accountの所有者がAさん、Leadの所有者がBさんの場合)。この場合に誰を優先するかのルールは本書作成時点で未決定。担当者間で事前合意がない場合は、変換を保留しエスカレーションする(5章参照)。
  3. 変換直後、変換先Account/Contact/Opportunity(作成した場合)の所有者が意図した担当者になっているかを変換後画面で確認する。

---

## 4. 活動履歴(Activity History)の保持

- Salesforce標準のLead変換機能は、LeadにひもづくTask/Event(活動履歴)を変換先のContact(および関連するAccount/Opportunity)へ自動的に引き継ぐ(Salesforce標準仕様)。
- 確認手順:
  1. 変換前にLeadの「活動」関連リストでTask/Eventの件数を確認する(スクリーンショットまたは件数メモで控える)。
  2. 変換後、変換先Contact(作成または既存)の「活動」関連リストを開き、変換前と同数のTask/Eventが引き継がれているかを確認する。
  3. 既存Contactを選択した変換の場合、既存Contactに元々あった活動履歴と、Leadから引き継がれた活動履歴の両方が残っていること(上書き・消失がないこと)を確認する。
  4. 件数が一致しない場合は、変換を完了させたままにせず、エスカレーション(5章)の対象とする。

---

## 5. 不要な商談(Opportunity)を作らない条件

Lead変換画面には「取引を作成しない」チェックボックスがある。以下のいずれかに該当する場合は、このチェックボックスを選択し、商談を新規作成しない。

- 変換先の既存Accountに、**進行中(Open)の商談が既に存在する**場合(重複商談の防止)。事前に取引先の「商談」関連リストで確認する。
- 診断・相談CTAクリックのみで、まだ有料契約化や具体的な商談化の合意に至っていない場合(`SALESFORCE_REQUIREMENTS_STATUS.md` に「商談化」は別イベントとして扱われる旨の記載がある。単なるLead→Contact/Account整理のための変換では商談を作らない)。
- 自動連携側で既にOpportunityの外部ID(`DentShift_Subscription_Id__c` 等、契約ID)によるupsertが見込まれるケース(契約・トライアル開始イベントが発生し、自動連携がOpportunityを作成・更新する想定の場合)は、手動変換で先に商談を作ると自動連携との重複の原因になり得るため、商談を作らない。

逆に、既存Accountに進行中の商談がなく、かつ営業担当が明確に新規の商談化(契約提案等)を意図している場合に限り、「取引を作成する」を選択する。判断に迷う場合は商談を作成せず、5章のエスカレーション対象とはせず、営業担当内での確認を優先してよい(商談作成は後からでも可能なため、作らない側に倒すことが安全)。

---

## 6. 競合時の停止条件(エスカレーション チェックリスト)

以下のいずれかに該当する場合、**変換操作を実行せず停止**し、担当者間で確認する(自動で一方を選んで進めない)。

1. **外部IDの重複候補が複数ある**: `DentShift_Clinic_Id__c` または `DentShift_User_Id__c` が一致するレコードが2件以上見つかった場合。
2. **情報が不十分**: Leadに `DentShift_Clinic_Id__c` が設定されていない、または空の場合(既存リード31件は医院IDが未設定であることが `SALESFORCE_PRODUCTION_ROLLOUT.md` 3章に記載されている。このようなLeadは外部IDでの突き合わせ自体ができないため、会社名・URL等の通常項目だけで判断せず停止する)。
3. **会社名・URL等は類似するが外部IDが一致しない**: 同一医院らしく見えても外部IDが異なる、または既存側に外部IDが入っていない場合。自動統合はしない方針(`SALESFORCE_REQUIREMENTS_STATUS.md` 未解決事項1、`PRODUCTION_MIGRATION_PLAN_2026-10-03.md` 4.2b節)に沿い、手動でも同一判断を確定させず停止する。
4. **所有者の競合**: 変換対象Leadの所有者と、変換先として選んだ既存Account/Contactの所有者が異なり、どちらを優先するかの合意がない場合(3章参照)。
5. **電話禁止(DoNotCall)の不整合が疑われる**: 既存Contactの `DentShift_Do_Not_Call__c` がtrue(電話禁止)なのに、Leadの値がfalseで、どちらを正とするか判断できない場合。
6. **活動履歴の件数不一致**: 変換後にTask/Eventの件数が変換前と合わない場合(4章参照)。
7. **変換先が既にコンバート済みの外部IDを持っている**: 既存Account/Contactの外部ID項目に、今回と異なる外部ID値が既に設定されている場合(`adoptConvertedRecord` のコード内コメントと同じ考え方で、自動で統合・上書きしない)。
8. **TimeRex予約等、医院紐付けが未確定の関連レコードがある**: `docs/TIMEREX_URL_PARAMS_INVESTIGATION_2026-10-03.md` に記載の通り `url_params` 欠落の原因が未特定であり、どの医院の予約か特定できない相談予約が残っている場合、その予約に関係するLead/Contactの変換は、紐付けの誤りに気づけないまま進めるリスクがあるため、該当予約の医院特定ができるまで保留する。

上記に該当しない(外部IDが一意に一致し、所有者・電話禁止・活動履歴に矛盾がなく、商談作成要否も5章の基準で判断できる)場合のみ、変換を実行してよい。

---

## 7. 本書の対象外・未解決事項

- 変換の実行そのもの、変換作業の自動化(Apex/Flow等)は本書の対象外。
- `DentShift_Preserve_Do_Not_Call_On_Convert` Flowの本番組織への反映状況は未確認(Sandbox dsverify限定と明記されているのみ)。
- Lead運用方針の最終決定(新規Leadの担当割当ルール等、`PRODUCTION_MIGRATION_PLAN_2026-10-03.md` 4.2a節)、および医院重複統合の要否(同4.2b節)は、本書では決定しない。これらが決定され次第、本書のチェックリスト(6章)を更新する必要がある。
- 本番組織の既存Lead(37件、`docs/SALESFORCE_PRODUCTION_LEAD_READONLY_CHECK.md`)のうち、本書の手順で手動変換すべき対象の洗い出しは別途必要(本書は手順のみを定め、対象リストの作成は行っていない)。
- 重複ルール・マッチングルールのSalesforceメタデータ(`.duplicateRule-meta.xml` 等)はリポジトリ内に見つからなかった。本番組織側で標準の重複ルール・マッチングルールがどう設定されているか(あるいは未設定か)は本書の調査範囲では確認できていない。6章のチェックリストはアプリ側のexternal ID突き合わせに基づくものであり、Salesforce標準の重複検出機能の設定状況とは独立している点に留意する。

---

## 8. Sandbox dsverifyでの事前確認結果(2026-10-03、読み取り専用)

> 本章はSandbox `dsverify`に対し、**SELECT/メタデータ読み取りAPIのみ**を使って行った確認結果である。Lead変換・レコード作成・更新・削除・設定変更は一切行っていない。接続は`scripts/salesforce-sandbox-e2e.ts`と同じOAuth Client Credentials Flow(`salesforce/.env.sandbox`、連携専用Integration User)を使用し、接続先がSandbox命名規則(`--dsverify.sandbox.`)かつ`SALESFORCE_EXPECTED_ORG_ID`と一致することを確認した上で実行した。本番Salesforceへは接続していない。個人情報(氏名・メール・電話番号等)は取得・記録していない。

### 8.1 外部ID項目・カスタム項目の実在確認(1章関連)

`sobjects/{Lead,Account,Contact}/describe` で確認した結果、1章・2章が参照する項目はすべて実在する。

| オブジェクト | 項目API名 | 存在 | 型 | nillable |
|---|---|---|---|---|
| Lead | `DentShift_Clinic_Id__c` | Yes | string | true |
| Lead | `DentShift_Do_Not_Call__c` | Yes | boolean | false(デフォルト値あり) |
| Account | `DentShift_Clinic_Id__c` | Yes | string | true |
| Contact | `DentShift_User_Id__c` | Yes | string | true |
| Contact | `DentShift_Do_Not_Call__c` | Yes | boolean | false(デフォルト値あり) |

いずれも必須(必ず入力)項目ではなく(nillable=true、またはboolean型でデフォルト値を持つ)、空欄のレコードが存在しうる設定である。

### 8.2 権限の確認(Convert Leads権限)— **確認不能**

- 接続中のIntegration User(連携専用、最小権限設計)は、`PermissionSet` オブジェクトへのSOQLクエリで `INVALID_TYPE`(`sObject type 'PermissionSet' is not supported`)となり、プロファイル/権限セットの内容を読み取れなかった。
- Tooling API(`/tooling/query`)で `Flow`・`FlowDefinition` 等を参照しても常に0件が返り、Tooling API自体への可視性がない(`salesforce-sandbox-e2e.ts`のコメントにある「Organizationオブジェクトが読めない」のと同種の、連携ユーザー最小権限によるアクセス制限と考えられる)。
- 結論: **このIntegration Userの認証情報では、Convert Leads権限の有無をAPI経由で確認できなかった**。確認するには、管理者権限を持つユーザー(`salesforce/.env.sandbox-admin`等、人間のログインが必要な認証情報)でのSetup画面確認、または連携ユーザーに一時的に権限参照用のアクセスを付与する必要がある(後者はPO指示により連携ユーザーの最小権限方針に反するため推奨しない)。

### 8.3 既存Account/Contact/Leadの外部ID設定状況(6章チェックリスト関連)

件数集計のみ(個人情報は取得していない)。

| オブジェクト | 総件数 | 外部ID設定済み | 未設定 |
|---|---|---|---|
| Account(`DentShift_Clinic_Id__c`) | 23 | 22 | 1 |
| Contact(`DentShift_User_Id__c`) | 20 | 20 | 0 |
| Lead(`DentShift_Clinic_Id__c`) | 35 | 28 | 7 |

- Leadの約2割(35件中7件)が医院ID未設定であり、6章チェックリスト項目2(「情報が不十分」)に該当しうるレコードがSandbox内にも一定数存在することを確認した。ただしこれはSandboxのテストデータであり、本番環境(37件中31件が医院ID未設定、`SALESFORCE_PRODUCTION_ROLLOUT.md`記載)の実態とは割合が異なる。
- 外部IDの重複(同一値を持つレコードが複数ある状態)の有無は、件数集計のみでは判別できないため未確認(個別の値を突き合わせる追加クエリが必要)。

> **運用ルール(PO判断、2026-10-03確定)**: 外部ID(`DentShift_Clinic_Id__c`)が未設定のAccount(1件)・Lead(7件、Sandbox確認時点の件数。本番は別途)は、**自動照合・自動変換の対象から除外**し、必ず個別確認(人が1件ずつ内容を見て判断)の扱いとする。欠落している外部IDの値をこちらで推測・補完して埋める操作は行わない。該当レコードは6章のチェックリスト(競合時の停止条件)の「外部ID未設定」に機械的に該当するものとして扱い、個別確認なしに変換を進めない。

### 8.4 Owner(所有者)の設定状況(3章関連)

`GROUP BY OwnerId` による集計のみ(OwnerIdは先頭6文字のみ記録、個人を特定しない)。

- Lead: Ownerグループ2種類(28件/7件)。大半が単一のOwnerに集中している。
- Account: Ownerグループ2種類(22件/1件)。同様に単一Ownerへの集中。
- Contact: Ownerグループ1種類(20件全件)。全件が単一Owner。

Sandboxのテストデータでは、Owner割当がほぼ単一ユーザーに集中しており、3章が指摘する「既存Accountの所有者とLeadの所有者が異なる」競合パターンを検証するには、Sandbox内のデータだけでは実例が乏しい(本番運用での複数担当者体制を想定した検証には別途テストデータの準備が必要)。

### 8.5 DoNotCall保持Flow(`DentShift_Preserve_Do_Not_Call_On_Convert`)の有効化状況 — **確認不能(方針確定: 管理者ログインで確認)**

- 8.2と同じ理由(Integration UserがTooling APIで0件しか返さない)により、Flowが実際にActive状態かをAPI経由で確認できなかった。
- `FlowDefinitionView`(通常のREST API)も`INVALID_TYPE`で参照不可。
- **項目の存在だけで「保持される」と判断してはならない**。確認すべきは(a) Active**バージョン**が存在するか(Draft/Obsoleteのみの可能性もある)、(b) 発火条件(どのレコードタイプ・どの操作でFlowが起動するか)、(c) 転記先(実際にどの項目へDoNotCall値をコピーしているか)の3点。
- **方針確定(PO判断、2026-10-03)**: 連携用Integration Userへの権限追加は行わない。代わりに、**管理者権限でのSandboxログインセッションで** Setup画面(フロー・ビルダー)から目視確認する。このセッション(Claude Code)に管理者ログイン済みのSandboxセッションが存在しない場合は、**この確認項目のみ保留**とする。

### 8.7 管理者ログインセッションでの目視確認結果(2026-10-03、Setup画面の読み取りのみ)

8.2・8.5で「確認不能」とした2点を、Chromeに残っていた**管理者(木村正人、システム管理者プロファイル)のSandbox `dsverify` ログインセッション**でSetup画面から目視確認した。設定変更・保存・権限変更は一切行っていない(Flow Builderは閲覧後に保存せず閉じ、「保存」ボタンが無効のままであることを確認した)。

#### 8.7.1 Convert Leads(「リードの取引の開始」)権限

| プロファイル | プロファイルID | 「リードの取引の開始」 | 備考 |
|---|---|---|---|
| システム管理者 | `00ed5000007OIpN` | **✓(有効)** | 木村正人が所属。有効ユーザー |
| 標準ユーザー | `00ed5000007OIpO` | **✓(有効)** | 営業担当(Sandbox)検証(`005BS00000NELMUYA5`)が所属 |

- **営業担当(Sandbox)検証ユーザーは「有効」チェックが外れており(無効化状態)**、このままでは手動変換の実施者・ドライランの別Ownerシナリオ(`SALESFORCE_MANUAL_CONVERSION_DRY_RUN_PLAN_2026-10-03.md` の所有者差異シナリオ)には使えない。有効化は設定変更にあたるため本セッションでは行っていない(POの判断・操作が必要)。
- 権限セットによる追加付与の有無は確認していない(プロファイル単位の確認のみ)。プロファイルで有効なため結論には影響しない。
- 本番組織の同プロファイル設定は未確認(S7は「Sandboxでは充足、本番は未確認」)。

#### 8.7.2 DoNotCall保持Flow `DentShift_Preserve_Do_Not_Call_On_Convert`(表示ラベル「DENT SHIFT 変換時電話禁止保持」)

| 確認項目 | 結果 |
|---|---|
| 有効バージョン | **V1が「有効」**(Flow ID `301BS00001m3c9gYAA`、最終保存 2026/10/2 13:10) |
| 種別 | レコードトリガーフロー、オブジェクト=リード、トリガー=**レコードが更新された**(作成時は対象外) |
| 実行タイミング | 「レコードを更新し、条件の要件に一致するたび」(after-save、「アクションと関連レコード」最適化) |
| エントリ条件(数式、全文) | `AND( ISCHANGED({!$Record.IsConverted}), {!$Record.IsConverted} = true, {!$Record.DentShift_Do_Not_Call__c} = true, NOT(ISBLANK({!$Record.ConvertedContactId})) )` |
| 要素 | 「レコードを更新」1つのみ(API参照名 `Update_Converted_Contact`)。対象=取引先責任者、条件=`取引先責任者 ID` が `{!$Record.ConvertedContactId}` と一致、設定=**`電話禁止`(DoNotCall)← True** |
| 非同期パス | なし |

- 読み取りからの解釈(断定ではなく数式・設定からの推論): Leadが「変換された」更新でのみ発火し、Lead側の`DentShift_Do_Not_Call__c`がtrueのときに限り、変換先Contactの**標準項目DoNotCall**をtrueにする。Contact側カスタム項目`DentShift_Do_Not_Call__c`(8.1)には書き込まない。Lead側の`DentShift_Do_Not_Call__c`がfalseの場合は何もしない(Contact側をfalseに「戻す」動作はない)。
- 既存Contactへ変換(マージ)する場合も`ConvertedContactId`が入るため条件上は発火するが、**実際の発火はドライラン(手順書別紙)で確認する**。
- 本番組織への同Flowのデプロイ有無・有効化状態は未確認(S6は「Sandboxでは充足、本番は未確認」)。

### 8.6 総括・次に必要な判断

- **確認できた**: 外部ID・カスタム項目(`DentShift_Clinic_Id__c`/`DentShift_User_Id__c`/`DentShift_Do_Not_Call__c`)はdsverify Sandbox上に実在し、型・必須設定も手順書の前提と矛盾しない。また外部ID未設定レコードが実データにも一定数存在することを確認した(1Account・7Leadは自動照合対象外・個別確認扱いとして運用ルール化済み、8.3節参照)。
- **確認できなかった(方針確定済み、管理者ログインで確認予定)**:
  1. **Convert Leads権限**: 連携用Integration Userではなく、**実際に手動変換を担当する(予定の)人**がConvert Leads権限を持っているかを確認する。連携ユーザーへの変換権限追加は不要・行わない。
  2. **DoNotCall保持Flowの詳細**(8.5参照): 有効バージョンの有無・発火条件・転記先。項目の存在のみでは判断しない。
- **次に必要な判断**: 上記2点は、管理者権限でのSandboxログインセッションでの目視確認が必要。このセッションに管理者ログイン済みのセッションがなければ、この2点のみ保留とし、他の作業は継続する。連携ユーザーへの一時的な権限付与は行わない方針が確定済み。
- **追記(2026-10-03、同日中)**: 上記2点はSandboxについて8.7節で確認済み(Convert Leads権限=両プロファイルで有効、Flow=V1有効・条件/転記先を読み取り)。残る未確認は(a)本番組織での同設定、(b)手動変換の担当者の決定、(c)営業担当(Sandbox)検証ユーザーの有効化要否(POの判断・操作)。
