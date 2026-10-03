# 本番(dentshift.jp)移行手順書

作成日: 2026-10-03
作成者: PO依頼によりClaude Codeが作成(ドキュメント作成のみ、本番操作は未実施)
対象ブランチ: `feature/salesforce-crm-sync`(masterから31コミット進行、未push)

> 本ドキュメントは読み取り専用調査(`git log`/`git diff`/`git status`/既存docs閲覧)のみに基づく。本番(dentshift.jp)・本番Salesforceへの操作は一切行っていない。

---

## 1. 対象環境

| 項目 | test(配備済み) | production(未配備) |
|---|---|---|
| ドメイン | test.dentshift.jp | dentshift.jp / www.dentshift.jp / app.dentshift.jp |
| Vercelプロジェクト | `dent-shift-test`(Git連携済み) | `dent-shift-production`(既存だが**Git未連携、要確認** — PRODUCTION_DEPLOYMENT.md記載) |
| DB | Vercel Marketplace管理型Postgres(test専用) | 新規に別DB作成が必要(testと共有禁止) |
| Salesforce組織 | Sandbox `dsverify`(Stage1で新規作成・検証済み) | Enterprise Edition本番組織(試用期限表示2026-10-18が残存し、**有料契約組織と同一かは未照合**) |
| SMS | 未設定(`SMS_PROVIDER=disabled`) | 未設定(同左、プロバイダー未確定) |
| TimeRex | 埋め込みウィジェット経由で検証中(url_params欠落事象あり) | 未着手(TimeRex側の原因特定待ち) |

影響範囲: dentshift.jp本番サイト、本番Postgres DB、本番Salesforce組織(Lead/Contact/Account/Opportunity)、Twilio(SMS実送信、個人カード決済中)、TimeRex予約Webhook連携。

---

## 2. 配備中(test環境に反映済み)と未配備の変更の整理

### 2.1 配備中と推定される内容
- `dent-shift-test` / `test.dentshift.jp` は `feature/salesforce-crm-sync` ブランチのGit連携プレビューで動作していると推定される(test環境での検証記録が複数docsにあるため)。ただし **「testに実際にどのコミットがデプロイ済みか」を示す一次情報(Vercelデプロイ履歴)はリポジトリ内の読み取りだけでは確認できない**。この点は本番移行判断前にVercelダッシュボードで実デプロイコミットSHAを確認すること。

### 2.2 未配備(masterにもdentshift.jp本番にもまだ反映されていない)変更
`master..feature/salesforce-crm-sync` に31コミット、275ファイル変更(+19,118/-993)。主な内容:

- **Salesforce連携一式(新規)**: `salesforce/force-app/`メタデータ、`src/server/providers/salesforce/salesforceClient.ts`、`src/server/services/salesforceSync.ts`、`src/domain/integration/salesforceCrmMapping.ts`(新規515行)、重複Lead/Contact対策、Lead→Contact変換時のDoNotCall保持Flow、管理者向け読み取り専用接続チェック。
- **TimeRex連携修正**: `src/components/timerex/`、`src/server/integration/bookingRef.ts`、`src/app/api/webhooks/timerex/route.ts` — 診断結果CTA・クリニック紐付け予約をurl_paramsウィジェット経由に統一する一連の修正(直近3コミット、2026-10-03付)。
- **Prisma schema変更×2件**(マイグレーションが伴う可能性があるため適用順序に注意、3章参照)。
- **運用スクリプト多数**: `scripts/salesforce-*.{ts,mjs}`(Sandbox専用、本番ホストガード付きのものを含む)。
- **ドキュメント新規7件**: `docs/SALESFORCE_*.md`一式。
- **`.claude/launch.json` の混入**(コミット`9dc3fbf`): STAGE1_FINAL_REPORT記載の通り無関係な変更が誤って混入しており、**ユーザー判断待ちのまま未解決**。本番マージ前に除去するか意図的に含めるか要確認。
- その他無関係な修正(tokushoho住所修正、画像配信方式変更など)も同ブランチに混在。

---

## 3. 事前条件(本番移行前に満たすべき条件)

以下は**現時点ですべて未充足**。1つでも未解決のまま本番適用することをPOは想定していない前提で記載する。

1. **TimeRex url_params欠落原因の特定または回避策確定**(4.1節・4.2c節参照) — 未解決。TimeRexの医院紐付け・日程変更後の紐付け維持は、PO判断により**本番有効化前の必須条件**(4.2c節参照)。
2. **Lead運用方針・医院重複統合の運用ルール最終合意**(4.2a節・4.2b節参照) — 未解決。
3. **SMS実送信体制の確定**(4.3節参照) — 未解決。
4. **本番Salesforce組織の同一性照合**(有料契約組織IDとAPI接続先組織IDが一致するか) — `SALESFORCE_PRODUCTION_ROLLOUT.md`記載の手順1が未完了。
5. **Salesforce連携ユーザーの権限最小化** — 現状「システム管理者」プロファイルで動作しており、本番投入前に専用インテグレーションユーザー(最小権限)への切替が必要(`SALESFORCE_PRODUCTION_ROLLOUT.md`記載)。
6. **Stage2検証の完了**(`SALESFORCE_STAGE1_FINAL_REPORT.md` 3章): Stripeテスト環境との実接続、TimeRex本番分離環境との実接続、本番Salesforce同期ログ集計、既存リードとの照合(4.2b節参照: 本番Lead総数37件、本番Clinic5件との名称・URL照合は実施済みで一致なし・URL欠損9件、メール照合は未実施。根拠ファイルは一部未特定)、契約組織確認。
7. **`dent-shift-production` VercelプロジェクトのGit連携状態の確認**(未連携の可能性、`PRODUCTION_DEPLOYMENT.md`記載)。
8. **本番用DBの新規作成**(testと共有しない)。
9. **`.claude/launch.json`混入の扱い決定**。
10. **Twilio法人カードへの差し替え**(個人カード決済は仮契約、メモリ記録済み)。
11. **PO/関係者による段階的承認**: `SALESFORCE_PRODUCTION_ROLLOUT.md`が定める「段階A(検証環境準備)→段階B(検証実施)→段階C(本番反映、項目ごとに個別承認)」のうち、現状は段階Aの一部(Sandbox `dsverify` 作成・検証=Stage1)が完了した段階。段階Cの個別承認は未取得。

---

## 4. 未決事項の明示(重要)

### 4.1 TimeRex: url_params欠落原因 未特定
- `docs/TIMEREX_URL_PARAMS_INVESTIGATION_2026-10-03.md`より: 実際の予約完了(event id `dfef9bfc3b3e70d79f94`)でWebhookの`event.url_params`に`ds_ref`が含まれなかった事象を確認。再現テストではクロスオリジンiframe内の時間枠クリックを自動操作で再現できず、原因はTimeRex埋め込みウィジェット内部にある可能性が高いと推測されるが**未特定**。
- TimeRex公式サポートへ2026-10-03問い合わせ済み、一次自動応答の後エスカレーション済みで**正式回答待ちで停止中**。
- 対象予約は取消済み(`ConsultationBooking.status = cancelled`)。
- **判断材料**: url_paramsが届かない場合、クリニック紐付け予約は会員メール完全一致でのみ紐づき、それ以外は「医院を特定できない予約」として運用画面に残る仕様(`SALESFORCE_REQUIREMENTS_STATUS.md`)。これは機能停止ではなく運用上のフォールバックがあるため、**原因特定を本番移行のブロッカーにするかはPO判断が必要**。ただし原因未特定のまま本番投入すると、本番環境でも同じ欠落が再現し、クリニック紐付けの精度が担保できないリスクがある。

### 4.2a Lead運用方針そのもの(重複Lead防止ルール・所有権/担当割当)
- `docs/SALESFORCE_REQUIREMENTS_STATUS.md`の未解決事項として: (1)TimeRex予約とds_ref紐付けの実際の到達可否(4.1および4.2cと関連)、(2)TimeRexのreschedule通知形式(取消+新規 or 同一ID再確定)未確認、(3)契約組織同一性未完了、(4)Salesforce構築チームとの決定記録がリポジトリ内に存在しない。
- `src/server/services/salesforceSync.ts`の`upsertContactAllowingOwnLeadDuplicate`は、「この医院自身の、同じEmailを持つ未コンバートLead」に限定してSalesforce標準重複ルールのallowSaveで再送する設計(重複Lead自体を防ぐルールではなく、Contact upsert時に自医院の既存Leadとだけ衝突した場合の救済策)。重複防止運用ルール(誰が・どの条件で統合/割当を判断するか)そのものは**最終決定していない**。代替設計の比較は`docs/SALESFORCE_ALLOWSAVE_ALTERNATIVES_2026-10-03.md`を参照。
- 所有権・担当割当: `SALESFORCE_PRODUCTION_ROLLOUT.md`3章に「担当営業(所有者)の手動変更は上書きしない」との記載はあるが、新規割当ルール(誰が新規Leadの担当になるか)の明文化はリポジトリ内に見つからなかった。

### 4.2b 医院(Clinic)の重複統合の要否
- `SALESFORCE_REQUIREMENTS_STATUS.md`記載の未解決事項: 未ログイン再診断により同じ医院が別の医院ID(=別Leadのexternal ID)になるケースがあり、自動統合しない方針を提案中・未決定。`SALESFORCE_PRODUCTION_ROLLOUT.md`3章も同様に「未ログインでの再診断により同じ医院が別の医院IDになるケースは未解決。自動統合はせず、`DentShift_Site_Domain__c`をSalesforceの重複ルール・レポートで確認する運用を推奨」とするのみで、最終承認された運用ルールではない。
- 既存Leadとの照合状況(件数の正確な記載): `docs/SALESFORCE_PRODUCTION_ROLLOUT.md`3章では、本番組織の既存リード31件について「確実に一致1件/要確認3件/対応先なし27件(うち19件はテスト用ドメインと推測)」という内訳を示しているが、これは**ローカルDBとの件数照合による概算**であり、同文書内に「本番DBとの照合は未実施」と明記されている。
  その後、`docs/SALESFORCE_PRODUCTION_LEAD_READONLY_CHECK.md`(2026-10-02、読み取り専用SOQL)で本番Salesforceから直接Id・作成日時・Status・IsConvertedを取得した結果、**本番Lead総数は37件**であることが確認された。同ファイルには「この37件のうちどれが元の31件に相当するかを機械的に突き合わせる基準が存在しない」と明記されており、同ファイルは氏名・会社名・URL等の個人情報/医院情報を一切取得していない(Id・作成日時・状態・変換有無のみ)。
  - **PO指摘による訂正**: 上記に対しPOから、「基準はLead37件で、本番Clinic5件との名称・URL照合は実施済み。一致なし、URL欠損9件、メール照合未実施という限定付き結果です」という数値が提示されている。これは「照合を一切行っていない」ではなく、「名称・URL照合は実施済みで一致なし、URL欠損が37件中9件、ただしメール照合は未実施」という限定的な結果として正確に記載する。
  - **根拠ファイルの特定状況**: リポジトリ内の`docs/SALESFORCE_SANDBOX_TEST_DATA_AUDIT.md`、`docs/SALESFORCE_PRODUCTION_LEAD_READONLY_CHECK.md`、`scripts/`配下(`salesforce-initial-sync.ts`、`salesforce-sandbox-e2e.ts`等)を確認したが、「本番Clinic5件」「名称・URL照合」「URL欠損9件」に該当する実施記録・出力ファイルは見つからなかった。`SALESFORCE_PRODUCTION_LEAD_READONLY_CHECK.md`は明示的に氏名・URL等を取得していないため、この照合はそれとは別の(本ドキュメント群に記録されていない)作業である可能性が高い。
    **→ PO提供の数値、根拠ファイル未特定。** 数値自体はPO指示のとおり正確に記載するが、再現性確認のためには実施記録(クエリ・出力)の提示または追記をPOに依頼することを推奨する。

### 4.2c TimeRexの医院紐付け・日程変更(reschedule)時の紐付け維持
- `docs/TIMEREX_URL_PARAMS_INVESTIGATION_2026-10-03.md`参照。`url_params`(`ds_ref`)の欠落原因は未特定で、TimeRex公式サポートへの問い合わせ後、正式回答待ちで停止中(4.1節参照)。
- reschedule(日程変更)時に`ds_ref`を含む紐付けが維持されるかは、同調査内で問い合わせ済みだが**未確認**(取消+新規作成なのか、同一イベントIDでの再確定なのかも含め未確認)。
- **PO判断(承認済み方針、そのまま記載)**: TimeRexの医院紐付け・日程変更後の維持は、今回の連携を本番有効化する前の必須条件である。

### 4.3 SMS実送信: 体制未確定
- **根拠(1): Twilio個人カード決済の件** — このプロジェクトのメモリ記録(`project_twilio_personal_card.md`)による申し送り事項: Twilioアップグレードは個人カード決済の仮契約であり、法人カード発行後に差し替えが必要。リポジトリ内の一次ファイルでは確認できないため、記録の出典はメモリであることを明示する。
- **根拠(2): IVRy確認待ちの件** — `.env.example`現在値: `SMS_PROVIDER=disabled`、コメントで「プロバイダー未確定(IVRyのOTP API可否を優先確認)」と明記されている(リポジトリ内の一次ファイル)。
- **矛盾**: `PRODUCTION_DEPLOYMENT.md`(2026-09-22付)は本番移行表で「SMS_PROVIDER=twilio-verify据え置き」と記載しているが、`.env.example`の最新コメントは「未確定・disabled」。**どちらが正式な現状か文書間で食い違っており、PRODUCTION_DEPLOYMENT.mdの記述が古い可能性が高い**。
- **今回実装したSMS認証(電話番号OTP)機能との関係**: サインアップ導線は電話番号OTP(SMS認証)を必須ステップとしている(`docs/DESIGN_HANDOFF_AUTH_PAGES_2026-09-20.md`に「`/verify-phone`へ遷移する(SMS認証が必須ステップのため)」と記載)。つまり、本番で`SMS_PROVIDER`が実際にSMSを送信できる状態(Twilio法人カードへの切替完了、またはIVRy採用確定のいずれか)になっていない限り、本番のサインアップ導線はSMS認証のステップで機能しない(新規会員登録が完了できない)。本番移行前に、決済手段の切替とプロバイダー(Twilio/IVRy)の最終決定が先に必要となる所以はここにある。
- **未確認事項(断定しない)**: IVRyでOTP送信用APIが実際に利用可能かどうかの最終結論は**未確認・要確認**。Twilio法人カードへの切替時期も本ドキュメント作成時点では未確定。

---

## 5. 適用順序(本番移行を実施する場合の想定手順)

**注意: 以下は手順の整理であり、実施の可否・実施タイミングはPO承認と4章の未決事項解消が前提。本セッションでは一切実施しない。**

1. 4章の未決事項すべてについてPO最終判断を得る(解消 or 許容してリスクを受け入れる旨の明示的承認)。
2. `.claude/launch.json`混入分の扱いを決定し、必要ならブランチから除去するコミットを作成。
3. `dent-shift-production` VercelプロジェクトのGit連携状態を確認・設定。
4. 本番用DB(Postgres)を新規作成(testと分離)。
5. `feature/salesforce-crm-sync` を master にマージ(レビュー後)。
6. 環境変数を本番Vercelプロジェクトに設定:
   - `DATABASE_URL`(新規本番DB)
   - `SALESFORCE_PROVIDER`(本番組織に接続する場合のみ有効化、組織ID照合完了後)
   - `SALESFORCE_EXPECTED_ORG_ID`(照合済みの本番組織IDを設定、不一致なら書き込み拒否される設計)
   - `SMS_PROVIDER`(4.3節の決定後に設定、未決定ならdisabled維持)
   - `TIMEREX_BOOKING_REF_SECRET`(url_params署名鍵、未設定の場合は参照を付けない仕様点に留意)
7. Prisma schema変更をデプロイ(`prisma migrate deploy`、Vercelビルド時に自動実行される設計。本番DBへの破壊的変更がないか事前にdiffを確認)。
8. アプリケーションをデプロイ(`vercel deploy --prod` 相当、ドメインエイリアス dentshift.jp / www.dentshift.jp / app.dentshift.jp)。
9. Salesforce連携を有効化する場合: 専用インテグレーションユーザー(最小権限)への切替を先に完了してから`SALESFORCE_PROVIDER`を有効値に変更。
10. TimeRex Webhook設定の向き先を本番に切替(4.1節の原因特定または許容判断が完了している場合のみ)。
11. SMS実送信を有効化する場合: 法人カード決済切替・プロバイダー最終決定の完了を確認してから`SMS_PROVIDER`を有効値に変更。

---

## 6. 復旧方法(ロールバック)

- **アプリ全体のロールバック**: Vercelの前回正常デプロイへの再デイリー(Vercelダッシュボードの「Promote to Production」機能、または前コミットへの再デプロイ)。
- **DBマイグレーションのロールバック**: `INCIDENT_RUNBOOK.md`にはSalesforce/TimeRex固有のロールバック詳細は記載がなく、一般的な障害対応フロー(opsツール`/ops/metrics`等での調査を優先、DB直接操作は最終手段)のみ。マイグレーションのロールバック手順は本ブランチのPrisma変更内容を個別に確認し、移行実施前に別途down-migration計画を用意する必要がある(**現状未整備**)。
- **Salesforce連携の即時停止**: `SALESFORCE_PRODUCTION_ROLLOUT.md` 6章記載の通り `SALESFORCE_PROVIDER=disabled` に戻すことで即時停止可能(環境変数変更のみ、再デプロイ要否は同文書を確認)。
- **SMS実送信の即時停止**: `SMS_PROVIDER=disabled` に戻す。
- **TimeRex連携**: Webhook向き先を元に戻す、または`url_params`依存のクリニック紐付けロジックを無効化してメール完全一致のみのフォールバックに切り替える。
- **注意**: Salesforce/TimeRex関連のロールバック手順が`INCIDENT_RUNBOOK.md`に統合されておらず`SALESFORCE_PRODUCTION_ROLLOUT.md`側にのみ存在する(9章の矛盾点参照)。本番移行実施時は両文書を参照できる体制を整えること。

---

## 7. 受け入れ条件

- [ ] dentshift.jp が新バージョンで正常に表示される(主要ページ・無料診断フロー)。
- [ ] 本番DBへの新規登録・既存データ読み取りが正常(マイグレーション後のデータ整合性確認)。
- [ ] Salesforce連携を有効化した場合: `SALESFORCE_EXPECTED_ORG_ID`照合が機能し、不一致時に書き込みが拒否されることを確認。
- [ ] Salesforce連携ユーザーが最小権限プロファイルで動作していることを確認(システム管理者プロファイルのままでないこと)。
- [ ] TimeRex予約のWebhook受信が正常に動作し、`ds_ref`欠落時のフォールバック(メール完全一致)が機能することを確認。
- [ ] SMS実送信を有効化した場合: 実際にテスト番号へOTPが届くことを確認、かつ決済が法人カードに切り替わっていることを確認。
- [ ] `/ops/metrics`、`/ops/integration-events`等の運用ツールで本番環境の同期イベントが正常に記録されることを確認。
- [ ] Vercel Function Logsにエラーが継続的に出力されていないことを確認(監視体制がログ目視のみである点を踏まえ、移行後24-48時間は重点確認)。
- [ ] `.claude/launch.json`の扱いが明確になっている(混入分が意図通りか)。

---

## 8. 既存ドキュメントとの矛盾点(上書きせず明記のみ)

1. **`PRODUCTION_DEPLOYMENT.md`(2026-09-22)が古い**: Salesforce着手前の前提(「disabled維持、今回のフェーズで触らない」)で書かれており、`SALESFORCE_PRODUCTION_ROLLOUT.md`(2026-10-01)以降の状況を反映していない。本番移行時のチェックリストとして`PRODUCTION_DEPLOYMENT.md`をそのまま使うと古い前提に基づいた判断をしてしまうリスクがある。
2. **SMS_PROVIDERの記載不一致**: `PRODUCTION_DEPLOYMENT.md`は「twilio-verify据え置き」、`.env.example`の現コメントは「未確定・disabled」。どちらが正式な現状か要PO確認。
3. **`SALESFORCE_REQUIREMENTS_STATUS.md`(2026-10-01更新)と`SALESFORCE_STAGE1_FINAL_REPORT.md`(2026-10-02作成)の整合性**: REQUIREMENTS_STATUSは「Sandbox未作成」等の記述が残るが、STAGE1_FINAL_REPORTではSandbox(`dsverify`)作成・検証完了を報告。REQUIREMENTS_STATUSが更新されないまま残っていると誤読のリスクがある。
4. **本番組織同一性照合の手順順序のずれ**: `SALESFORCE_PRODUCTION_ROLLOUT.md`は組織ID照合(手順1)をSandbox作成(手順2)より前に置いているが、実際にはこの照合が完了しないままSandbox検証(Stage1)が先行して完了している。
5. **ロールバック手順の分散**: Salesforce関連のロールバック手順が`INCIDENT_RUNBOOK.md`に統合されておらず`SALESFORCE_PRODUCTION_ROLLOUT.md`のみに存在する。

---

## 9. 参考ドキュメント一覧

- `docs/PRODUCTION_DEPLOYMENT.md`
- `docs/SALESFORCE_PRODUCTION_ROLLOUT.md`
- `docs/SALESFORCE_REQUIREMENTS_STATUS.md`
- `docs/SALESFORCE_STAGE1_FINAL_REPORT.md`
- `docs/SALESFORCE_STAGE1_RUNBOOK.md`
- `docs/salesforce-stage2-report-2026-10-03.md`
- `docs/SALESFORCE_CRM_FIELD_SPEC.md`
- `docs/SALESFORCE_PRODUCTION_LEAD_READONLY_CHECK.md`
- `docs/SALESFORCE_SANDBOX_TEST_DATA_AUDIT.md`
- `docs/SALESFORCE_PRODUCTION_LEAD_READONLY_CHECK.md`
- `docs/SALESFORCE_ALLOWSAVE_ALTERNATIVES_2026-10-03.md`
- `docs/TIMEREX_URL_PARAMS_INVESTIGATION_2026-10-03.md`
- `docs/INCIDENT_RUNBOOK.md`
- `docs/TEST_DEPLOYMENT.md`
- `.env.example`
