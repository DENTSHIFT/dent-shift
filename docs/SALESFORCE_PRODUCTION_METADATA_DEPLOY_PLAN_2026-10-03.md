# 本番Salesforceへのメタデータ配備計画(未承認・読み取り結果に基づく提案)

作成: 2026-10-03 / 対象ブランチ `feature/salesforce-crm-sync`
前提: **本書は計画であり、配備・変換・同期有効化・設定変更は一切行っていない。** 実行はPOの個別承認後、Claudeが管理者セッション/承認済み資格情報で行う(Salesforce上の実行ユーザー=木村正人、操作担当=Claude として記録する)。

## 0. 移行順序(PO方針 2026-10-03)

1. **メタデータ配備・検証**(本書) → 2. **データ照合と外部ID対応の確定** → 3. **対象限定の手動変換** → 4. **同期有効化**(`SALESFORCE_PROVIDER=salesforce`)。
各段階は前段の結果をPOが確認してから進む。1.自体が未承認。

## 1. 本番組織の特定(2026-10-03、管理者画面「組織情報」読み取り)

| 項目 | 読み取り結果 | 既存記録との照合 |
|---|---|---|
| 組織名 | エムコレクションジャパン合同会社(Enterprise Edition) | Twilio決済カード名義(M.COLLECTION JAPAN LLC)と同一法人 |
| My Domain | `inspiration-customization-3670.my.salesforce.com` | ローカル`.env`の`SALESFORCE_LOGIN_URL`ホストと一致。2026-10-02の本番Lead読み取り(`SALESFORCE_PRODUCTION_LEAD_READONLY_CHECK.md`、Lead Id接頭辞`00Qd5…`)と同一組織 |
| 組織ID | 画面で読み取り済み(先頭`00Dd5`、Sandbox `00DBS…`とは別)。**本書・リポジトリには全桁を記載しない**(`SALESFORCE_PRODUCTION_ROLLOUT.md`の方針)。`SALESFORCE_EXPECTED_ORG_ID`へ設定する際は、画面の値を**環境変数ファイル(gitignore)に直接書く** | `SALESFORCE_EXPECTED_ORG_ID`はローカル`.env`・Vercel本番とも**未設定**(本番環境変数一覧に`SALESFORCE_*`なし) |
| 試用表示 | 「トライアルの残り日数 14」(2026-10-03時点)。組織情報「ユーザーライセンス」: Salesforce 5(使用1)/Chatter Free/Identity/Chatter External/Salesforce Integration 5(使用0)/Analytics Cloud Integration User 2、**全ライセンスの有効期限 2026/10/18**、ヘッダーに「今すぐ購入」ボタン(未購入状態) | `SALESFORCE_PRODUCTION_ROLLOUT.md`の「試用期限 2026-10-18」と整合 |
| 採用判断 | **PO確認済み(2026-10-03): 現在の組織を本番用として採用。管理画面で取得した組織IDを`SALESFORCE_EXPECTED_ORG_ID`の照合基準とする**(契約書への組織ID記載は必須としない) | 試用終了後(2026/10/18以降)の契約・継続利用は**別項目**。Setup内に契約/請求ページ(Checkout)は見つからず(`/lightning/setup/Checkout/home`は「ページが見つかりません」)、読み取りで確認できたのはライセンス期限のみ。購入・契約変更は行わない |

## 2. 本番DBの特定(2026-10-03、Vercel `dent-shift-production` 読み取り、値は未表示)

| 項目 | 読み取り結果 |
|---|---|
| Storage | Neon `neon-byzantine-tree`(Free)、`dent-shift-production` の Production に接続、作成 Sep 22 |
| 環境変数(Production) | Neon統合が注入: `DATABASE_URL`、`DATABASE_URL_UNPOOLED`、`POSTGRES_URL`、`POSTGRES_PRISMA_URL`、`POSTGRES_URL_NON_POOLING`、`POSTGRES_URL_NO_SSL`、`PGHOST`、`PGHOST_UNPOOLED`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DATABASE`、`NEON_PROJECT_ID`(いずれもSep 22)。他: `APP_BASE_URL`、Stripe系、Resend系、Twilio系、`SMS_PROVIDER`、`BILLING_PROVIDER`、OpenAI系、`PILOT_INVITE_MODE`、`ARTIFACT_PASSWORD_ENC_KEY`。**`SALESFORCE_*`は無し** |
| Prisma接続 | `prisma/postgres/schema.prisma` は `env("DATABASE_URL")` → 本番アプリはNeonへ接続している |
| デプロイ | Production: Sep 24–25は Git(`master`、例 `9a6d92b`)経由、Sep 27–30は `vercel deploy`(CLI)経由(最新 `5GKAmEMjB`、Sep 30)。CLIデプロイのソースコミットは一覧に表示されない |
| 既存記録との差 | `SALESFORCE_PRODUCTION_GO_NOGO` S10「本番DB未作成」・`PRODUCTION_DEPLOYMENT.md`「production用DB未作成」は**古い**。DBは存在する。ただし`IntegrationEvent`/`CrmSyncLock`テーブルのマイグレーション適用状況は未確認 |
| Neonコンソール(2026-10-03、管理者セッション、読み取りのみ) | 組織「Vercel: DENTSHIFT」配下に3プロジェクト: **`neon-byzantine-tree`(ID `bold-mud-80895548`、本番)**、`dent-shift-test-db`、`neon-aqua-ridge`。本番プロジェクトのブランチ: `main`(default、`br-lucky-mode-b31ne8sa`、2026-09-22作成)+バックアップ用 `pre-release-2026-09-27`、`pre-migration-20260930-diagnosis-ratelimit-utm`。Postgres 18、Free plan。SQL Editorの履歴に2026-09-23〜30の運用クエリ(削除・更新を含む)が残っており、**このDBが稼働中の本番データ**である |
| `main` の集計(SQL Editor) | Clinic **5** / Contact 3 / Diagnosis 5。`_prisma_migrations` **26件**(最新 `20260929130000_add_diagnosis_rate_limit`)。同期テーブルは `IntegrationEvent` のみ存在し、**`CrmSyncLock` は無い** → ローカルの27件目 `20261001120000_salesforce_crm_sync` が**未適用**(S10は「DB存在・最新マイグレーション未適用」が正確) |
| 過去報告「本番Clinic 5件」との照合 | Neon `main` のClinic件数5と一致。過去照合の読み取り元はこのDBと推定できる(当時の出力は未保存のため推定) |
| 資格情報の読込経路 | 接続文字列のローカル書き出しは**行わない**(PO方針)。読み取りはNeonコンソールのSQL Editorで実施し、個人情報を含む列は取得せず、照合キーは `md5` ハッシュでのみ取り出した |

### 2.1 本番Lead/Clinic照合結果(2026-10-03、読み取りのみ、個人情報なし)

- Salesforce側: `.env`の本番Client Credentialsで接続。OAuth応答の組織IDが画面読み取りの組織IDと一致することを確認してから照会(`scripts/output/prod-lead-hashes-20261003.json`、gitignore)。Lead 37件、全件未変換、`DentShift_Clinic_Id__c` 項目なし、Website空 9件、Email空 0件。
- DB側: Neon `main` のClinic 5件の `name`/`url`ホスト/`contactEmail`/所属Contactの`email` を md5 化(`scripts/output/prod-clinic-hashes-20261003.json`)。
- 照合(名称: 空白除去+小文字 / URL: ホスト名(www.除去) / メール: 小文字):

| 分類 | 件数 | 内訳 |
|---|---|---|
| 一意一致 | **1** | Lead `00Qd500000EroeXEAR`(2026-09-28作成)→ Clinic `cmujiyx670000sdn6igw9yrv2`(2026-09-27作成)。**メール一致のみ**(名称・URLは不一致) |
| 候補複数 | 0 | — |
| 一致なし | **36** | うちWebsite空 9件 |
| 情報不足 | 0 | 全Leadに会社名・メールあり |

- 補足: 名称・URLでは一致0件(2026-10-02の過去報告「名称・URLで一致なし、URL欠損9件」と整合)。メール照合は今回初めて実施し、1件一致。
- DB側の注意: Clinic `cmuf3tyj500019ui2sb7twdk2`(09-24)と `cmupfwkc600027nyls4s7e5vj`(10-01)は**同一ホスト・同一メール**(未ログイン再診断による同一医院の重複、`SALESFORCE_REQUIREMENTS_STATUS.md`の未解決事項の実例)。この2件はLeadとは一致しないが、同期有効化時に別Lead 2件が作られる。
- 限界: 名称の正規化がDB側(SQL)とLead側(NFKC適用)で完全には一致しないため、全角/半角差のある名称一致を取りこぼす可能性がある。結果ファイル: `scripts/output/prod-lead-clinic-match-20261003.json`。
- **変換候補の整理(段階3の材料)**: 実行可能候補は上記1件のみ(既存Account/Contactは本番に外部ID項目が無く、Lead→Account/Contactの「既存紐付け先」は本番Salesforce側にそもそも存在しない=本番Account/Contact件数の確認が別途必要)。残り36件は「一致なし」=手順書8.3の個別確認扱いで、**変換しない**(停止対象)。

## 3. 配備対象(`salesforce/force-app`、`salesforce/manifest/package.xml`)

| 種別 | 内容 | 既存レコードへの影響 |
|---|---|---|
| CustomField(Lead 21・Account 14・Contact 10・Opportunity 14) | 外部ID(`DentShift_Clinic_Id__c`/`DentShift_User_Id__c`/`DentShift_Subscription_Id__c`)、電話禁止・根拠、診断要約、UTM、契約状態など | 項目追加のみ。**既存レコードの外部IDは空のまま**(メタデータ追加では埋まらない)。チェックボックス既定値(電話禁止=true)は新規作成時に適用され、既存37件への適用有無は配備後にSOQLで確認する(確認までtrue/falseを仮定しない) |
| CustomObject 2(`DentShift_Diagnosis__c`、`DentShift_Consultation__c`) | 診断履歴・相談予約 | 新規オブジェクト。既存データに影響なし |
| ValidationRule 2(Lead/Contact `DentShift_Do_Not_Call_Reason_Required`、`active=true`) | 数式 `AND(DentShift_Do_Not_Call__c = FALSE, ISBLANK(DentShift_Do_Not_Call_Reason__c))`。挿入・更新の両方で評価 | **配備前に確定した影響(3.1節)**: 既存37件は配備後「電話禁止=false・根拠空」になり、**編集(外部ID入力を含む)も変換も入力規則で止まる**。配備後の調査では遅いため、配備前に3.1節の対処を決める |
| Flow 1(`DentShift_Preserve_Do_Not_Call_On_Convert`、Active) | 変換時に電話禁止をContactへ引き継ぐ(Sandboxで実測済み、ドライラン計画10.5) | 変換時のみ発火。既存データに影響なし |
| PermissionSet 2(`DentShift_Integration`、`DentShift_Sales_Staff`) | 連携ユーザー・営業向けの項目権限 | 割り当ては `--assign-permission-set` を付けた場合のみ(既定は割り当てない) |
| **含まれないもの** | リード項目の対応付け(電話禁止→電話禁止、根拠→根拠)、リストビュー2件(架電対象)、ページレイアウト/Flexipage(別スクリプト `salesforce-layout-*.mjs`/`salesforce-flexipage-metadata-deploy.mjs`) | 対応付けはSetup画面での**手動設定(設定変更)**が必要。無い場合、新規Contact作成での変換で電話禁止がContactへ転記されない |

### 3.1 入力規則の配備前影響検証(2026-10-03、読み取りと公式ヘルプに基づく)

| 確認項目 | 結果 | 根拠 |
|---|---|---|
| 規則の数式・有効化 | `AND(DentShift_Do_Not_Call__c = FALSE, ISBLANK(DentShift_Do_Not_Call_Reason__c))`、`<active>true</active>`。Lead・Contactとも同一 | `salesforce/force-app/.../validationRules/DentShift_Do_Not_Call_Reason_Required.validationRule-meta.xml` |
| 新規項目の既定値 | `DentShift_Do_Not_Call__c` は `<defaultValue>true</defaultValue>`。**既定値は新規作成時のみ適用され、既存レコードには適用されない**(既存レコードは未チェック=false) | Salesforceヘルプ「Default Field Value Considerations」「Default Field Values」(https://help.salesforce.com/s/articleView?id=platform.fields_default_field_value_considerations.htm 、https://help.salesforce.com/s/articleView?id=fields_about_default_field_values.htm ) |
| 更新時の評価 | 入力規則は挿入・更新で評価。**変換時の評価は「取引開始済みのリードに入力規則が必須」設定に依存**し、本番・Sandboxとも **✓(有効)** を2026-10-03にリード設定画面で確認 → 変換時にも評価される | Setup「リードの設定」; ヘルプ「Validation Rule Considerations」(https://help.salesforce.com/s/articleView?id=fields_validation_considerations.htm ) |
| 既存データ相当ケースのSandbox検証 | **実施不可**: Sandbox(dsverify)のLead 35件・Contact 20件はすべて2026-10-02作成(項目配備後)で、「電話禁止=false・根拠空」のレコードは0件。項目配備前のレコードがSandboxに存在しないため、既存データ相当の状態を**設定変更(項目の再作成)なしには再現できない** | Sandbox SOQL集計(非DRYRUN: Lead true 21/false 14、Contact true 14/false 6、いずれも根拠空0) |
| 結論 | 本番Lead 37件(+既存Contact)は配備直後に規則へ抵触する状態になり、(1) 手動変換は変換時評価で失敗、(2) 外部ID入力などの編集も失敗する。**既存データの一括書換えで回避しない**方針のため、配備内容側で対処する | — |

対処案(配備前に決める。いずれも**未承認**):

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| A. 入力規則を**無効(`active=false`)で配備** | 項目・Flow・権限セットは配備、規則は無効のまま。既存37件の整理(変換・外部ID入力)が終わってから、別承認で有効化 | 既存データを触らない。変換・編集が止まらない | 有効化までの間、新規Leadの電話禁止解除に根拠を強制できない(新規は既定値trueなので「根拠なしで解除」のみ素通りする) |
| B. 数式に**配備日以前の既存レコード除外**を追加 | `AND(CreatedDate >= <配備日時>, 電話禁止=FALSE, ISBLANK(根拠))` 等 | 新規には即時適用 | 数式変更(設計変更)。既存37件は規則対象外のまま残り、整理後に数式を戻す運用が必要 |
| C. 数式を「解除時のみ」に戻す(`ISCHANGED`/`PRIORVALUE`) | 既存のfalse状態の維持は許容し、true→false の変更時のみ根拠必須 | 既存データに影響しない | Stage1で「常時チェックへ強化」した設計(`SALESFORCE_STAGE1_FINAL_REPORT.md` 1.1)を後退させる |

推奨: **A**(配備物の差分が最小で、既存データを書き換えず、後から有効化できる)。採否はPO判断。

## 4. 必要な権限・接続

- **権限セットは割り当てない**(PO方針 2026-10-03)。割り当ては、`DentShift_Integration`/`DentShift_Sales_Staff`の内容と必要権限の差分を確認した後に別途判断(配備・割当とも保留)。
- 配備は `scripts/salesforce-metadata-deploy.mjs`(Metadata REST deployRequest)。実行時環境変数 `SALESFORCE_CLIENT_ID / SECRET / LOGIN_URL / EXPECTED_ORG_ID` を**ファイルから`source`**して渡す(コマンド行に書かない)。組織ID不一致で中断。本番は `--deploy --allow-production` を明示しない限り反映されない(既定は `checkOnly`=検証のみ)。
- 接続ユーザーは「カスタマイズ」「メタデータAPI」権限が必要。現状の本番接続資格情報(`.env`のClient Credentials)はシステム管理者相当で動作している(`PRODUCTION_MIGRATION_PLAN` 3章#5のとおり専用Integration User未作成)。配備後の同期運用では最小権限ユーザーへの切替(S4)が別途必要。

## 5. 検証(配備前後、読み取りのみ)

1. 配備前: `node scripts/salesforce-metadata-deploy.mjs`(checkOnly)で成功を確認。失敗なら本番に何も反映されない。
2. 配備後: `sobjects/{Lead,Account,Contact,Opportunity}/describe` でDentShift_*項目の実在と型、Flow一覧でActive、入力規則の有効、権限セットの存在を確認(Sandbox 8.1/8.7と同じ手順)。
3. 既存Lead 37件: `SELECT Id, DentShift_Do_Not_Call__c, DentShift_Do_Not_Call_Reason__c, DentShift_Clinic_Id__c FROM Lead` の件数集計(値は個人情報を含まない)。外部IDは全件空であることを前提に、2.の照合へ。
4. 対応付け(手動設定後): Setup「リードの項目の対応付け」を目視。

## 6. 復旧方法(データを消さない案を優先。いずれも実行は未承認)

| 優先 | 事象 | 復旧操作 | データへの影響 |
|---|---|---|---|
| 1 | 入力規則で編集・変換が止まる | 入力規則を**無効化**(Setup画面、または`active=false`で再配備) | なし(項目・値は残る) |
| 2 | Flowが想定外に動く | Flowを**無効化**(Setup「フロー」でバージョンを無効化、または`status=Obsolete`で再配備) | なし |
| 3 | 権限セットの影響 | 割り当て解除(本計画では割り当てない) | なし |
| 4 | 同期側の想定外書き込み(段階4以降) | `SALESFORCE_PROVIDER=disabled`(`SALESFORCE_PRODUCTION_GO_NOGO` 5章) | Salesforce側レコードは残る |
| 最終手段 | 項目自体を撤去したい | `--rollback`(項目・オブジェクト・権限セットの**削除**)。**項目に入力された値も失われる**ため「安全」とは扱わず、PO承認と事前エクスポート(4.1節バックアップ)が無い限り実行しない | **あり(不可逆)** |

- 復旧の優先順位は「設定の無効化 → 同期停止 → (最終手段)削除」。項目は残しておいても既存機能に影響しない(入力規則・Flowが無効なら項目追加は受動的)。

## 7. 本書で決めないこと

- 有料契約組織との同一性(S3)。契約情報の提示があるまで配備承認の前提を満たさない。
- 本番DB資格情報の取得方法(2章)。
- 既存Leadの電話禁止値の統一方針(3章 ValidationRule)。
