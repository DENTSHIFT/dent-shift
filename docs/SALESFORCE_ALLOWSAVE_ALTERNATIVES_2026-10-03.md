# Salesforce Contact upsert: allowSave(保存許可)を使わない代替案の比較

作成日: 2026-10-03
作成者: PO依頼によりClaude Codeが作成(設計比較資料。実装の差し替えは行っていない)
対象コード: `src/server/services/salesforceSync.ts`(`upsertContactAllowingOwnLeadDuplicate`)、`src/server/providers/salesforce/salesforceClient.ts`(`upsertSalesforceRecordByExternalId`、`Sforce-Duplicate-Rule-Header`)

> PO前提(既承認・そのまま記載): **allowSaveの競合リスクはSandbox検証に限り許容。本番適用は未承認。**
> 本資料は比較・設計検討のみを目的とし、コードの変更・デプロイは行っていない。

---

## 1. 現行方式(allowSave)の仕組み・リスク・メリット

### 1.1 仕組み
- `src/server/providers/salesforce/salesforceClient.ts`の`requestSalesforce`は、`Sforce-Duplicate-Rule-Header`に`allowSave=true`/`includeRecordDetails=true`を付与してREST APIへ単一レコードのexternal ID upsert(`PATCH /sobjects/Contact/<externalIdField>/<value>`)を送信する。
- `src/server/services/salesforceSync.ts`の`upsertContactAllowingOwnLeadDuplicate`は以下の2段階:
  1. 通常upsert(`includeDuplicateRecordDetails: true`)を送る。
  2. Salesforce標準重複ルールにより`DUPLICATES_DETECTED`(400)が返った場合のみ、エラーに含まれる重複候補(オブジェクト種別+IDのみ)を検査し、「候補が1件以上あり、かつそのすべてが『この医院自身の、今回のContactと同じEmailを持つ、未コンバートLead』と一致する」場合に限って`allowDuplicateSave: true`で再送する。それ以外(候補情報が取れない/0件/Lead以外混在/自医院以外のLead)はすべて拒否してエラーを投げる。

### 1.2 リスク(TOCTOU、コード内コメントに既知の制約として明記)
- `Sforce-Duplicate-Rule-Header`のallowSaveは「特定の候補IDだけ」を保存許可する仕組みではなく、「この1回の保存リクエスト全体」に対して重複アラートを無視するかどうかのフラグでしかない。
- 1回目(候補取得)と2回目(allowSave再送)は別々のAPI呼び出しであり、その間に別プロセスの書き込みやSalesforce側の非同期インデックス更新で、実際に検出される重複の中身が変わる余地が理論上ある。
- 現実的な発生可能性は極めて低い(同一医院・同一メールのLeadという限定条件下でのみ再送する設計のため)が、完全には排除できないとコード内コメントで明記されている。

### 1.3 メリット
- 実装がシンプル(REST APIの標準ヘッダー1つで済み、追加のSOQLクエリや事前ロックが不要)。
- Salesforce標準の重複ルール・マッチングルールをそのまま活用でき、ルール変更時もアプリ側コード変更が不要(Salesforce管理画面側の設定のみで追従できる)。
- 候補の事前検証ロジック(自医院の未コンバートLeadのみ許可)により、無関係な重複まで誤って保存許可するリスクをある程度抑えている。

---

## 2. 代替案

### 案A: 事前SOQLクエリによる厳密な一意性チェック(allowSave不使用)
Contact upsert前に、`SF_FIELDS.contact.externalId`またはEmail+医院の外部IDで対象候補を明示的にSOQLクエリし、「自医院の未コンバートLeadが存在する場合のみ、そのLeadをConvertしてからContactを更新する」フローに変更する。allowSaveは一切使わず、重複ルールに引っかかった場合は即座にエラーとして扱い、アプリ側で検出した候補のみを信頼する。

- 仕組み: (1) Contact upsert前に`SELECT Id FROM Lead WHERE <externalIdField> = :clinicId AND Email = :email AND IsConverted = false`を実行、(2) 0件ならそのままContact upsert(通常のallowSave無しリクエスト)、(3) 1件なら`Database.convertLead()`相当のLead Convert APIで先にConvertしてからContact upsertを再試行、(4) DUPLICATES_DETECTEDが発生した場合は即座にエラーとして運用画面に出す(再送しない)。
- `src/server/services/salesforceSync.ts`には既にLead Convert呼び出し(`convertLead`相当、`input.convertedId`を扱う関数が近傍に存在)があり、実装基盤は一部流用できる。

### 案B: Salesforce Bulk API 2.0のupsertジョブを使う
個別のREST同期ではなく、Bulk API 2.0(`/services/data/vXX.X/jobs/ingest`)でexternal ID upsertジョブを作成し、Salesforce側のトランザクション・バッチ処理に重複判定を一任する。Bulk APIのingestジョブは重複ルールのエラーをレコード単位の失敗として結果ファイルに返すため、allowSaveのような「全体に対する保存許可フラグ」を使わずに済む(失敗したレコードだけを個別にエラーハンドリングする設計にできる)。

- 現状、`src/server/providers/salesforce/salesforceClient.ts`はBulk APIを実装しておらず、単一レコードのREST upsert(`upsertSalesforceRecordByExternalId`)のみ。Bulk API対応には新規クライアントコード(ジョブ作成・CSV/JSON投入・ポーリング・結果取得)の追加が必要。
- 本サービスは医院単位・イベント単位の都度同期(Webhook契機のリアルタイム性が前提)であり、Bulk APIは本来まとめて大量データを非同期処理する用途のため、1件ずつの即時同期には不向き(ジョブ作成からクローズまで数秒〜数分のレイテンシが発生しうる)。初期移行時の一括データ投入(既存31/37件のLeadとの突合作業等)には適性があるが、日常のリアルタイムContact upsertの置き換えとしては過剰かつレイテンシ面で不利。

### (参考・不採用) Salesforce側の自動保存抑止に任せてエラーハンドリングのみ行う案
重複ルールのアクション設定自体を「保存をブロック」のままにし、アプリ側では`DUPLICATES_DETECTED`を受けたら一切再送せず、常に運用画面の「要確認」キューに回す案。実装は最も単純だが、現行要件(自医院の同一Email Leadとの衝突は自動的に解消したい)を満たせず、これまでSandbox E2Eで検証済みのLead→Contact変換フローの自動化効果が失われるため、比較表には参考として記載するのみで独立案としては推さない。

---

## 3. 比較表

| 観点 | 現行(allowSave) | 案A(事前SOQL厳密チェック+Lead Convert) | 案B(Bulk API 2.0 upsert) |
|---|---|---|---|
| 実装コスト | 低(既存実装済み) | 中(事前クエリ・Convert呼び出し・リトライ制御の追加実装が必要。Lead Convert関連コードの一部は流用可) | 高(Bulk APIクライアント新規実装: ジョブ作成/データ投入/ポーリング/結果取得、既存のWebhook都度同期アーキテクチャとの整合も要再設計) |
| 競合耐性(TOCTOU) | クエリ→再送の間に理論上の競合余地あり(極めて低確率、コード内コメントで明記) | クエリ→Convert→upsertの間に競合余地は残るが、allowSaveのような「全体許可フラグ」に頼らずアプリ側で候補を確定させるため、原理的な見通しは現行よりやや良い(ただし完全な排除ではない。SOQLとその後の書き込みの間に別プロセスが割り込む可能性は残る) | ジョブ単位のバッチ処理のためリクエスト単位の競合は起きにくいが、ジョブのクローズまでのレイテンシ中に他の同期が走った場合の扱いは別途設計要 |
| 本番適用の可否(現時点) | 未承認(Sandbox検証のみ許容、PO前提) | 未評価(新規実装のため追加のSandbox検証が必要) | 未評価(新規実装のため追加のSandbox検証が必要、かつリアルタイム同期要件との整合を先に確認する必要) |
| Sandbox限定でよいか | 現状はSandbox限定で許容されている(PO前提) | Sandbox限定での試験導入は可能(既存のSandbox E2E基盤`scripts/salesforce-sandbox-e2e.ts`等を流用できる見込み) | Sandbox限定での試験導入は可能だが、リアルタイム同期ユースケースでは本番導入の見込みが低いため、初期データ移行用途に絞った検証が現実的 |
| 備考 | Salesforce標準重複ルールの設定変更に追従しやすい | Lead Convert済みレコードの扱い等、既存のDoNotCall保持Flowとの整合を要確認 | 本サービスの都度同期モデルとは設計思想が異なるため、採用する場合はアーキテクチャ変更に近い |

---

## 4. まとめ・推奨

- 日常のリアルタイムContact upsertを置き換える目的であれば、**案A(事前SOQL厳密チェック+Lead Convert)**が現行アーキテクチャとの親和性が高く、実装コストも相対的に小さい。ただし競合耐性は「原理的にやや改善」にとどまり、TOCTOUを完全には排除できない点は現行と同様に明記しておく必要がある。
- **案B(Bulk API)**はリアルタイム同期には不向きだが、初期データ移行(既存Lead 31/37件との名寄せ作業など、`docs/PRODUCTION_MIGRATION_PLAN_2026-10-03.md` 4.2b節参照)のような一括処理用途であれば検討価値がある。
- いずれの案も新規実装であり、Sandbox `dsverify`での追加検証(既存の`scripts/salesforce-sandbox-e2e.ts`等を流用)なしに本番適用することはできない。本番適用はPO未承認のままであり、本資料はその判断材料として作成した比較に留まる。
