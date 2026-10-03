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
| 試用表示 | 「トライアルの残り日数 14」(2026-10-03時点) | `SALESFORCE_PRODUCTION_ROLLOUT.md`の「試用期限 2026-10-18」と整合。**有料契約組織との同一性(契約書・請求書の組織ID)は依然未照合**(S3)。契約情報の提示が無い限り「意図した本番移行先」とは断定しない |

## 2. 本番DBの特定(2026-10-03、Vercel `dent-shift-production` 読み取り、値は未表示)

| 項目 | 読み取り結果 |
|---|---|
| Storage | Neon `neon-byzantine-tree`(Free)、`dent-shift-production` の Production に接続、作成 Sep 22 |
| 環境変数(Production) | Neon統合が注入: `DATABASE_URL`、`DATABASE_URL_UNPOOLED`、`POSTGRES_URL`、`POSTGRES_PRISMA_URL`、`POSTGRES_URL_NON_POOLING`、`POSTGRES_URL_NO_SSL`、`PGHOST`、`PGHOST_UNPOOLED`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DATABASE`、`NEON_PROJECT_ID`(いずれもSep 22)。他: `APP_BASE_URL`、Stripe系、Resend系、Twilio系、`SMS_PROVIDER`、`BILLING_PROVIDER`、OpenAI系、`PILOT_INVITE_MODE`、`ARTIFACT_PASSWORD_ENC_KEY`。**`SALESFORCE_*`は無し** |
| Prisma接続 | `prisma/postgres/schema.prisma` は `env("DATABASE_URL")` → 本番アプリはNeonへ接続している |
| デプロイ | Production: Sep 24–25は Git(`master`、例 `9a6d92b`)経由、Sep 27–30は `vercel deploy`(CLI)経由(最新 `5GKAmEMjB`、Sep 30)。CLIデプロイのソースコミットは一覧に表示されない |
| 既存記録との差 | `SALESFORCE_PRODUCTION_GO_NOGO` S10「本番DB未作成」・`PRODUCTION_DEPLOYMENT.md`「production用DB未作成」は**古い**。DBは存在する。ただし`IntegrationEvent`/`CrmSyncLock`テーブルのマイグレーション適用状況は未確認 |
| 過去報告「本番Clinic 5件」との照合 | 2026-10-02の照合がどのDB(Neon本番 / ローカル)を読んだかは、当時の出力が未保存のため**特定できない**。再照合で置き換える |
| **資格情報の読込経路** | ローカル`.vercel/project.json`は `dent-shift-test` にリンク。本番DBの接続文字列はローカルに存在せず、既存の安全な読込経路(`source` できるファイル)が**無い**。取得するには `vercel env pull --environment=production`(本番プロジェクトへのリンク変更が必要)等で秘密値をローカルへ書き出す必要があり、これは新たな資格情報の持ち出しにあたる → **保留。POの承認が必要**(承認時は gitignore 対象ファイルへ書き出し、値は表示しない) |

## 3. 配備対象(`salesforce/force-app`、`salesforce/manifest/package.xml`)

| 種別 | 内容 | 既存レコードへの影響 |
|---|---|---|
| CustomField(Lead 21・Account 14・Contact 10・Opportunity 14) | 外部ID(`DentShift_Clinic_Id__c`/`DentShift_User_Id__c`/`DentShift_Subscription_Id__c`)、電話禁止・根拠、診断要約、UTM、契約状態など | 項目追加のみ。**既存レコードの外部IDは空のまま**(メタデータ追加では埋まらない)。チェックボックス既定値(電話禁止=true)は新規作成時に適用され、既存37件への適用有無は配備後にSOQLで確認する(確認までtrue/falseを仮定しない) |
| CustomObject 2(`DentShift_Diagnosis__c`、`DentShift_Consultation__c`) | 診断履歴・相談予約 | 新規オブジェクト。既存データに影響なし |
| ValidationRule 2(Lead/Contact `DentShift_Do_Not_Call_Reason_Required`) | 電話禁止=false かつ根拠空 → 保存不可 | **注意**: 既存Lead/Contactが「電話禁止=false・根拠空」になる場合、以後の**編集・変換(更新)が入力規則で止まる**。配備直後に既存37件の値をSOQLで確認し、運用方針(trueで統一するか、根拠を入力するか)を決めてから変換に進む |
| Flow 1(`DentShift_Preserve_Do_Not_Call_On_Convert`、Active) | 変換時に電話禁止をContactへ引き継ぐ(Sandboxで実測済み、ドライラン計画10.5) | 変換時のみ発火。既存データに影響なし |
| PermissionSet 2(`DentShift_Integration`、`DentShift_Sales_Staff`) | 連携ユーザー・営業向けの項目権限 | 割り当ては `--assign-permission-set` を付けた場合のみ(既定は割り当てない) |
| **含まれないもの** | リード項目の対応付け(電話禁止→電話禁止、根拠→根拠)、リストビュー2件(架電対象)、ページレイアウト/Flexipage(別スクリプト `salesforce-layout-*.mjs`/`salesforce-flexipage-metadata-deploy.mjs`) | 対応付けはSetup画面での**手動設定(設定変更)**が必要。無い場合、新規Contact作成での変換で電話禁止がContactへ転記されない |

## 4. 必要な権限・接続

- 配備は `scripts/salesforce-metadata-deploy.mjs`(Metadata REST deployRequest)。実行時環境変数 `SALESFORCE_CLIENT_ID / SECRET / LOGIN_URL / EXPECTED_ORG_ID` を**ファイルから`source`**して渡す(コマンド行に書かない)。組織ID不一致で中断。本番は `--deploy --allow-production` を明示しない限り反映されない(既定は `checkOnly`=検証のみ)。
- 接続ユーザーは「カスタマイズ」「メタデータAPI」権限が必要。現状の本番接続資格情報(`.env`のClient Credentials)はシステム管理者相当で動作している(`PRODUCTION_MIGRATION_PLAN` 3章#5のとおり専用Integration User未作成)。配備後の同期運用では最小権限ユーザーへの切替(S4)が別途必要。

## 5. 検証(配備前後、読み取りのみ)

1. 配備前: `node scripts/salesforce-metadata-deploy.mjs`(checkOnly)で成功を確認。失敗なら本番に何も反映されない。
2. 配備後: `sobjects/{Lead,Account,Contact,Opportunity}/describe` でDentShift_*項目の実在と型、Flow一覧でActive、入力規則の有効、権限セットの存在を確認(Sandbox 8.1/8.7と同じ手順)。
3. 既存Lead 37件: `SELECT Id, DentShift_Do_Not_Call__c, DentShift_Do_Not_Call_Reason__c, DentShift_Clinic_Id__c FROM Lead` の件数集計(値は個人情報を含まない)。外部IDは全件空であることを前提に、2.の照合へ。
4. 対応付け(手動設定後): Setup「リードの項目の対応付け」を目視。

## 6. 復旧方法

- `node scripts/salesforce-metadata-deploy.mjs --rollback --allow-production`: 追加した項目・オブジェクト・権限セットを削除する。**項目に入力済みのデータも消える**ため、照合・外部ID入力(段階2)を始めた後は取り消しの影響が大きい。段階1の直後(データ未入力)に限り安全なロールバック点とする。
- Flow/入力規則のみを止める場合は、Setupで無効化(設定変更、個別承認)。

## 7. 本書で決めないこと

- 有料契約組織との同一性(S3)。契約情報の提示があるまで配備承認の前提を満たさない。
- 本番DB資格情報の取得方法(2章)。
- 既存Leadの電話禁止値の統一方針(3章 ValidationRule)。
