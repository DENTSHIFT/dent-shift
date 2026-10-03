# Salesforce Lead手動変換 ドライラン実行計画(Sandbox dsverify・専用ダミーデータ)

作成: 2026-10-03 / 対象ブランチ: `feature/salesforce-crm-sync`
作成者: PO依頼によりClaude Codeが作成(計画書のみ。本書作成にあたりSalesforce(Sandbox・本番とも)への書き込み・変換・設定変更・接続は一切行っていない)

> 本書は `docs/SALESFORCE_LEAD_MANUAL_CONVERSION_PROCEDURE_2026-10-03.md`(以下「手順書」)の手動変換手順を、Sandbox `dsverify` 上の**検証専用ダミーデータ**で安全に試すための実行計画である。
> **本書の内容はまだ実行されていない。** ダミーデータの作成・変換の実行は、POが本書の「対象と影響」(3章・9章)を確認し承認した後に行う。承認前にSandboxへ書き込む作業はない。
> 手順書8章の読み取り確認結果(外部ID項目の実在、外部ID未設定レコード数、Owner分布、管理者ログインが必要な2点)を前提として組み立てている。

---

## 0. 目的と範囲

- **目的**: 手順書1〜6章の各確認手順(外部ID照合・DoNotCall保持・Owner保持・活動履歴引き継ぎ・商談を作らない・停止条件)が、実際のLead変換画面と変換結果で手順書の記載どおりに機能するかを、既存レコードに触れずに確認する。
- **範囲内**: Sandbox `dsverify` のみ。検証専用に新規作成するダミーレコードのみを変換対象とする。
- **範囲外**: 本番組織への接続・操作、既存のSandboxレコード(`docs/SALESFORCE_SANDBOX_TEST_DATA_AUDIT.md` 記載の「【検証】」系データ、自動連携が作成した「検証 院長」系データ)の変換・更新・削除、Flow/権限/重複ルール等の設定変更、Apex/Flowによる自動変換の実装。
- **実行者**: 手動変換を担当する予定の人(管理者権限ユーザー、`salesforce/.env.sandbox-admin` 相当のログイン)。連携用Integration Userは使わない(手順書8.6で確定済みの方針: 連携ユーザーへの権限追加は行わない)。

---

## 1. ダミーデータ設計

### 1.1 命名規則(既存テストデータとの混同防止)

| 項目 | 規則 | 理由 |
|---|---|---|
| 名称プレフィックス | `【DRYRUN-MC】` | 既存Sandboxデータは `【検証】` または `検証 院長`(自動連携作成)を使っているため、別のプレフィックスで区別する。MC = Manual Conversion。 |
| 名称本体 | `【DRYRUN-MC】S{a〜f} {役割}`(例: `【DRYRUN-MC】Sa 既存Account`) | シナリオ記号を名称に含め、一覧・検索で即座に判別できるようにする。 |
| 外部ID(`DentShift_Clinic_Id__c`) | `dryrun-mc-20261003-s{a〜f}-clinic` | アプリ側の医院IDはcuid形式(英数字25桁程度)であり、`dryrun-mc-` で始まる値は自動連携が生成する値と衝突しない。日付を含めることで再実施時にも一意にできる。 |
| 外部ID(`DentShift_User_Id__c`) | `dryrun-mc-20261003-s{a〜f}-user` | 同上。 |
| `DentShift_Site_Domain__c` | `dryrun-mc-s{a〜f}.invalid` | `.invalid` は予約TLDで実在ドメインと衝突しない。重複ルール(存在するなら)の誤検出を避ける。 |
| メールアドレス | 設定しない(空欄) | 手順書1.1「メールでは統合しない」方針に沿い、またSalesforce標準の重複ルールがメール一致で警告を出す可能性を排除するため。Leadの必須項目は `LastName`・`Company` のみで、メールは不要。 |
| 電話番号 | 設定しない(空欄) | 個人情報を一切含めない。 |

**全レコード共通の注意**: ダミーデータには実在の医院名・人名・連絡先を一切使わない。`DentShift_Do_Not_Call__c` は新規作成時の既定値がtrue(手順書2章・8.1)のため、シナリオ(e)以外のLeadでは**作成時に明示的にfalseへ変更する**(既定値のままだと全シナリオでDoNotCall保持Flowが発火し、(e)の検証が他と区別できなくなる)。

### 1.2 シナリオ別レコード(最小セット)

| # | シナリオ | 事前に作成するレコード | 外部ID設定 | Owner | DoNotCall | 活動 |
|---|---|---|---|---|---|---|
| (a) | 既存Accountに外部ID一致で紐付く | Account `【DRYRUN-MC】Sa 既存Account` / Lead `【DRYRUN-MC】Sa Lead` | Account・Leadとも `dryrun-mc-20261003-sa-clinic` | 両方とも実行者 | false | なし |
| (b) | 既存Contactに外部ID一致で紐付く | Account `【DRYRUN-MC】Sb 既存Account` / Contact `【DRYRUN-MC】Sb 既存Contact`(上記Accountに所属) / Lead `【DRYRUN-MC】Sb Lead` | Account・Lead: `dryrun-mc-20261003-sb-clinic`、Contact: `dryrun-mc-20261003-sb-user`。**Leadには `DentShift_User_Id__c` 相当の項目がないため**、Leadの変換先Contactの判断は「Lead側医院ID一致Account配下に、ユーザーID `…-sb-user` のContactが存在する」ことで行う(手順書1.2手順3)。 | 全て実行者 | false(Contactもfalse) | なし |
| (c) | 外部ID未設定で個別確認扱い(自動照合対象外) | Lead `【DRYRUN-MC】Sc Lead(外部ID未設定)` のみ | `DentShift_Clinic_Id__c` を**空のまま** | 実行者 | false | なし |
| (d) | OwnerがLeadと既存Accountで異なる(競合→停止) | Account `【DRYRUN-MC】Sd 既存Account(別Owner)` / Lead `【DRYRUN-MC】Sd Lead` | Account・Leadとも `dryrun-mc-20261003-sd-clinic` | **Accountは実行者以外のSandboxユーザー**、Leadは実行者 | false | なし |
| (e) | `DentShift_Do_Not_Call__c = true` のLead | Lead `【DRYRUN-MC】Se Lead(電話禁止)` のみ | `dryrun-mc-20261003-se-clinic` | 実行者 | **true** | なし |
| (f) | 活動履歴(Task/Event)を持つLead | Lead `【DRYRUN-MC】Sf Lead(活動あり)` + Task 1件(件名 `【DRYRUN-MC】Sf Task`)+ Event 1件(件名 `【DRYRUN-MC】Sf Event`) | `dryrun-mc-20261003-sf-clinic` | 実行者 | false | Task 1 / Event 1 |

**事前作成レコード件数(合計12件)**: Lead 6、Account 3、Contact 1、Task 1、Event 1。
**Opportunityは作成しない**(事前・変換時とも0件)。

### 1.3 シナリオ(d)の前提: 第2ユーザー

- (d)は「既存Accountの所有者が実行者と異なる」状態を作る必要があり、Sandboxに実行者以外の**有効なユーザー**(ライセンスあり・Account所有可能)が必要。手順書8.4のとおりSandboxのOwner分布は2種類(連携用Integration Userと実行者と推定)のみ。
- **追記(2026-10-03 管理者画面で確認、手順書8.7.1)**: Sandboxには実行者以外の人間ユーザー「営業担当(Sandbox)検証」(標準ユーザープロファイル、Convert Leads権限あり)が存在するが、**「有効」が外れた無効化状態**のため、現状のままでは(d)のAccount Ownerに設定できない。有効化は設定変更にあたり本計画では行わない(POが有効化するか、(d)を実施不可として残すかの判断が必要)。
- Integration Userを(d)のAccount Ownerにすることは、連携ユーザーの扱いを検証用に流用することになり、推奨しない。**実行者以外の人間ユーザーがSandboxに存在しない場合、(d)は「Owner欄に別ユーザーを設定できない」として実施不可とし、本書の未確認事項(7章)に残す**。新規ユーザー作成は設定変更に当たるため、本計画では行わない。

---

## 2. 各シナリオの期待結果と確認方法

### 2.0 全シナリオ共通: 変換画面の操作と「商談を作らない」確認

1. 変換画面(Lead詳細 →「取引開始」)で、商談セクションは必ず **「取引を作成しない」にチェック**を入れる(手順書5章: 整理目的の変換では商談を作らない)。
2. 変換前後でOpportunity件数が変わらないことをSOQLで確認する。

```sql
-- 変換前・変換後に同じクエリを実行し、件数が一致することを確認
SELECT COUNT() FROM Opportunity
-- ダミーデータ由来の商談が1件も無いことの確認(常に0件であるべき)
SELECT Id, Name FROM Opportunity WHERE Name LIKE '【DRYRUN-MC】%'
-- 変換元Leadに商談IDが入っていないことの確認(全シナリオ)
SELECT Id, Name, IsConverted, ConvertedAccountId, ConvertedContactId, ConvertedOpportunityId
FROM Lead WHERE Name LIKE '【DRYRUN-MC】%'
```

期待: `COUNT()` が変換前後で同数、`LIKE '【DRYRUN-MC】%'` の商談が0件、全Leadの `ConvertedOpportunityId` がnull。

### 2.1 シナリオ(a): 既存Accountへの紐付け

| 操作 | 変換画面で「既存の取引先を選択」→ `【DRYRUN-MC】Sa 既存Account` を選択(手順書1.2手順2・4: 外部ID一致を先に確認してから選ぶ)。Contactは「新規作成」。 |
|---|---|
| 期待 | Leadの `ConvertedAccountId` = 事前作成Accountの Id。新規Accountが作られていない。Accountの `DentShift_Clinic_Id__c` が書き換わっていない(手順書1.2手順5)。 |
| 確認SOQL | `SELECT Id, Name, DentShift_Clinic_Id__c FROM Account WHERE DentShift_Clinic_Id__c = 'dryrun-mc-20261003-sa-clinic'` → **1件のみ**。`SELECT ConvertedAccountId FROM Lead WHERE Name = '【DRYRUN-MC】Sa Lead'` がそのIdと一致。 |

### 2.2 シナリオ(b): 既存Contactへの紐付け

| 操作 | 「既存の取引先を選択」→ `Sb 既存Account`、「既存の取引先責任者を選択」→ `Sb 既存Contact`(事前に `DentShift_User_Id__c = …-sb-user` のContactであることをSOQLで確認してから選ぶ)。 |
|---|---|
| 期待 | Leadの `ConvertedContactId` = 事前作成ContactのId。新規Contactが作られていない。Contactの `DentShift_User_Id__c` が書き換わっていない。 |
| 確認SOQL | `SELECT Id, DentShift_User_Id__c, AccountId FROM Contact WHERE DentShift_User_Id__c = 'dryrun-mc-20261003-sb-user'` → **1件のみ**、AccountIdがSb Accountと一致。`SELECT COUNT() FROM Contact WHERE Name LIKE '【DRYRUN-MC】Sb%'` が変換前後で同数(=1)。 |

### 2.3 シナリオ(c): 外部ID未設定 → 停止(変換しない)

| 操作 | 変換画面を**開かない**。Lead詳細で `DentShift_Clinic_Id__c` が空であることを確認した時点で、手順書6章項目2(情報が不十分)および8.3運用ルール(外部ID未設定は個別確認扱い)に該当するため**停止**する。 |
|---|---|
| 期待 | Leadが未変換のまま残る。外部IDを推測して埋める操作は行わない(8.3運用ルール)。 |
| 確認SOQL | `SELECT Id, IsConverted, DentShift_Clinic_Id__c FROM Lead WHERE Name LIKE '【DRYRUN-MC】Sc%'` → `IsConverted = false`、外部IDはnullのまま。 |
| 本シナリオの意義 | 「停止条件に該当するLeadを、画面上で誤って変換しに行かないか」という**運用手順の確認**であり、Salesforceの機能確認ではない。 |

### 2.4 シナリオ(d): Owner競合 → 停止(変換しない)

| 操作 | 手順書1.2に従い外部ID一致のAccount(`Sd 既存Account`)を特定した時点で、そのOwnerがLeadのOwnerと異なることを確認する。手順書3章・6章項目4のとおりOwner優先ルールは未決定のため、**変換画面で確定ボタンを押さずに停止**する(変換画面を開いて候補を確認するまでは可。「変換」ボタンは押さない)。 |
|---|---|
| 期待 | Leadが未変換のまま残る。Accountの Owner が変わっていない。 |
| 確認SOQL | `SELECT Id, OwnerId FROM Account WHERE DentShift_Clinic_Id__c = 'dryrun-mc-20261003-sd-clinic'` の OwnerId が事前作成時のまま。`SELECT IsConverted FROM Lead WHERE Name = '【DRYRUN-MC】Sd Lead'` = false。 |
| 補足 | 1.3のとおり第2ユーザーが無い場合は実施不可。 |

### 2.5 シナリオ(e): DoNotCall保持

| 操作 | 変換前に Lead の `DentShift_Do_Not_Call__c = true` を確認(手順書2章手順1)。Account・Contactとも「新規作成」で変換。 |
|---|---|
| 期待 | 変換先Contactの `DentShift_Do_Not_Call__c = true`。Flow `DentShift_Preserve_Do_Not_Call_On_Convert`(リポジトリ上の定義: Lead更新後トリガー、`ISCHANGED(IsConverted) && IsConverted && DentShift_Do_Not_Call__c && ConvertedContactId != null` で変換先Contactの同項目をtrueに更新)が有効なら保持される。 |
| 確認SOQL | `SELECT Id, DentShift_Do_Not_Call__c FROM Contact WHERE Id = '<Se LeadのConvertedContactId>'` → true。 |
| 注意 | **新規Contactの `DentShift_Do_Not_Call__c` 既定値はtrue**(手順書8.1)のため、新規作成Contactで値がtrueでも「Flowが働いた」証明にはならない。Flowの動作証明には **既存Contact(false)を変換先に選ぶ** 追加ケースが必要だが、本計画の最小セットには含めない。本シナリオで確認できるのは「変換後も true が失われない」ことまで。Flowの有効性そのものは7章の未確認事項(管理者ログインでの目視確認)で担保する。 |

### 2.6 シナリオ(f): 活動履歴の引き継ぎ

| 操作 | 変換前にLeadの「活動」関連リストでTask 1・Event 1を確認(手順書4章手順1)。Account・Contactとも「新規作成」で変換。 |
|---|---|
| 期待 | 変換先ContactにTask 1・Event 1が引き継がれる(`WhoId` が変換先ContactIdに付け替わる)。件数が変換前と一致する(不一致なら手順書6章項目6でエスカレーション)。 |
| 確認SOQL | `SELECT Id, Subject, WhoId, WhatId FROM Task WHERE Subject LIKE '【DRYRUN-MC】Sf%'` および同じ条件の `Event` → それぞれ1件、`WhoId` = Sf LeadのConvertedContactId。 |

---

## 3. 影響範囲

### 3.1 既存レコードへの影響: ゼロ(理由)

- 変換対象は本計画で新規作成する `【DRYRUN-MC】` プレフィックスのLead 6件のみ。既存Lead(手順書8.3時点で35件)・既存Account(23件)・既存Contact(20件)は、変換画面で**選択しない**(外部ID `dryrun-mc-…` を持つ既存レコードは存在しないため、手順書1.2の外部ID照合で既存レコードが候補になることはない)。
- 外部ID値 `dryrun-mc-…` はアプリ側のcuid形式と形が異なり、自動連携(`salesforceSync.ts` のupsert)が同じ外部IDでレコードを更新・紐付けすることはない。
- Opportunityは作成しない(2.0)。
- 設定変更(Flow・権限・重複ルール・ユーザー作成)は行わない。
- 自動連携が稼働中であっても、ダミーレコードはアプリ側DBに存在しない医院IDのため、連携側から参照・更新されることはない。

### 3.2 作成・変更されるレコード件数

| 区分 | オブジェクト | 件数 | 備考 |
|---|---|---|---|
| 事前作成(人手) | Lead | 6 | (a)〜(f) |
| 事前作成(人手) | Account | 3 | (a)(b)(d) |
| 事前作成(人手) | Contact | 1 | (b) |
| 事前作成(人手) | Task / Event | 1 / 1 | (f) |
| 変換により自動作成 | Account | 2 | (e)(f)。(a)(b)は既存Account選択のため増えない、(c)(d)は停止 |
| 変換により自動作成 | Contact | 3 | (a)(e)(f)。(b)は既存選択、(c)(d)は停止 |
| 変換により自動作成 | Opportunity | **0** | 全シナリオで「取引を作成しない」 |
| 変換により更新 | Lead | 4 | (a)(b)(e)(f) が `IsConverted = true` に。(c)(d)は未変換 |
| 変換により更新 | Task / Event | 1 / 1 | (f) の `WhoId` 付け替え |

Sandbox全体では **人手作成12件 + 変換による新規5件(Account 2 / Contact 3) = 最大17件** のレコードが増える。

### 3.3 後片付け

- 検証後のダミーレコードは**削除せず残す**(本書の前提)。削除の要否は別途POの承認事項とし、本書では扱わない。
- 残置する理由: 変換結果(`ConvertedAccountId` 等)の事後監査と、本番運用前の再確認に使えるため。また変換済みLeadの削除は変換先レコードとの整合を崩しうるため、慎重な判断が必要。
- 残置に伴う注意: `docs/SALESFORCE_SANDBOX_TEST_DATA_AUDIT.md` と同様に、検証後に作成レコードのIdと作成者を一覧化して記録する(9章テンプレートの実績欄)。

---

## 4. 実行手順(手順書6章チェックリスト順)

各ステップに「停止すべき条件」を明記する。停止した場合はその場で作業を止め、状況を記録してPOに報告する(自動で別案に進まない)。

### Step 0: 前提確認(Sandbox接続前)

| 確認 | 停止条件 |
|---|---|
| POが本書(特に3章・9章)を確認し、ダミーデータ作成と変換の実行を承認済みか | 承認が無い → **開始しない** |
| 7章の未確認事項(Convert Leads権限・DoNotCall Flow)が確認済みか | 未確認 → Step 4以降(変換実行)に進まない。Step 1〜3(データ作成・変換前確認)までは実施可 |
| ログイン先が `dsverify` Sandbox(URLに `--dsverify.sandbox.` を含む)であり、本番組織でないこと | 本番URL・組織IDが `SALESFORCE_EXPECTED_ORG_ID`(Sandbox)と不一致 → **即停止** |
| ログインユーザーが手動変換担当予定の管理者ユーザー(Integration Userでない) | Integration Userでログインしている → 停止 |

### Step 1: ダミーデータ作成(1.2の12件)

| 操作 | 停止条件 |
|---|---|
| Account 3件 → Contact 1件 → Lead 6件 → Task/Event 各1件の順で作成。各レコード作成直後に名称・外部ID・Owner・DoNotCall値をSOQLで確認する | 作成時に重複ルール警告が出た(=既存レコードと一致候補扱いされた) → 保存せず停止。既存データと衝突する可能性があるため原因を確認する |
| `SELECT Id, Name, DentShift_Clinic_Id__c, OwnerId, DentShift_Do_Not_Call__c FROM Lead WHERE Name LIKE '【DRYRUN-MC】%'` で6件、各値が1.2と一致 | 件数・値が不一致 → 修正してから次へ(修正できなければ停止) |
| 2.0の変換前Opportunity `COUNT()` を記録 | — |

### Step 2: 変換前確認(手順書1.2・2章手順1・3章手順1・4章手順1)

各Leadについて、手順書1.2の順で外部ID一致Account/Contactを検索し、結果を9章テンプレートに記入する。

| 確認(手順書6章項目) | 停止条件 |
|---|---|
| 項目1: 外部ID一致レコードが2件以上 | 該当 → そのシナリオを停止(ダミー外部IDは一意のはずなので、該当したら作成ミスか既存データとの偶然の一致) |
| 項目2: 外部ID未設定 | (c)は**想定どおり該当 → 停止**(これが(c)の期待結果)。(c)以外で該当 → 作成ミス、Step 1に戻る |
| 項目3: 名称類似だが外部ID不一致 | 該当なしのはず(ダミー名称は既存と類似しない)。該当 → 停止 |
| 項目4: Owner競合 | (d)は**想定どおり該当 → 停止**。(d)以外で該当 → 作成ミス |
| 項目5: DoNotCall不整合(既存Contact true・Lead false) | (b)は両方falseのため非該当のはず。該当 → 停止 |
| 項目7: 変換先の外部IDが別値 | 該当なしのはず。該当 → 停止 |
| 項目8: 医院紐付け未確定のTimeRex予約 | ダミーデータには関連予約がないため非該当 |

### Step 3: 7章の未確認事項の確認結果を記録

| 確認 | 停止条件 |
|---|---|
| 実行者にConvert Leads権限がある(Setup → ユーザー → プロファイル/権限セット) | 権限なし → **Step 4に進まない**(権限付与は設定変更のため本計画では行わない) |
| Flow `DentShift_Preserve_Do_Not_Call_On_Convert` のActiveバージョン・発火条件・転記先(Setup → フロー) | Activeでない/発火条件・転記先がリポジトリ定義(2.5)と異なる → **(e)のみ保留**、他は継続可。差異内容を記録 |

### Step 4: 変換実行((a)(b)(e)(f)の4件のみ)

| 操作 | 停止条件 |
|---|---|
| 1件ずつ変換画面を開き、2章の「操作」欄のとおり既存/新規を選択し、**「取引を作成しない」にチェック**した上で「変換」を押す | 画面上の既存候補の外部IDが、Step 2で確認したIdと一致しない → 変換せず停止(手順書1.2手順4) |
| 変換直後に変換後画面でAccount/Contactの Owner を確認(手順書3章手順3) | Ownerが実行者でない → 以降の変換を止めて記録 |
| 各件ごとに2章の確認SOQLを実行 | 期待と不一致 → 以降の変換を止めて記録(途中で止める。残りの変換は再開判断を待つ) |

(c)(d)は**変換しない**。Step 2での停止がそのまま期待結果となる。

### Step 5: 変換後の全体確認

| 確認 | 停止条件(=エスカレーション対象) |
|---|---|
| 2.0: Opportunity `COUNT()` が変換前と同数、`【DRYRUN-MC】` の商談0件、全Leadの `ConvertedOpportunityId` null | 不一致 → 不要な商談が作成された。原因(チェック漏れ/組織設定)を記録 |
| 2.6: Task/Eventの `WhoId` が(f)の変換先Contact | 不一致 → 手順書6章項目6 |
| 2.5: (e)変換先Contactの DoNotCall = true | false → 手順書2章手順2(Flow未有効化の疑い)。項目を手で直さない |
| 既存レコードの非変更確認: `SELECT COUNT() FROM Lead WHERE IsConverted = true AND Name NOT LIKE '【DRYRUN-MC】%'` が変換前と同数 | 増えている → ダミー以外のLeadが変換された。即報告 |
| 9章テンプレートの実績欄を埋め、作成レコードのId一覧を記録 | — |

---

## 5. 停止時の扱い

- 停止はすべて「期待どおり」または「要調査」のどちらかとして記録し、要調査の場合は原因が分かるまで次のシナリオに進まない。
- 停止したシナリオのダミーレコードも削除しない(3.3)。
- 途中停止した場合も、Step 5の「既存レコードの非変更確認」だけは必ず実施する。

---

## 6. 本計画で確認できないこと(限界)

- Owner優先ルール(手順書3章)は未決定のため、(d)は「停止できるか」のみ確認し、「どちらを優先すべきか」は確認しない。
- Flowの動作証明(2.5注意欄): 新規Contactの既定値がtrueのため、本計画の(e)ではFlowが働いた証明にはならない。証明には「既存Contact(DoNotCall=false)を変換先に選ぶ」追加ケースが必要(本計画外。実施する場合は手順書6章項目5との整合をPOと要相談)。
- Salesforce標準の重複ルール・マッチングルールの設定状況(手順書7章)は本計画でも確認しない(Step 1で警告が出た場合に初めて存在が分かる)。
- 本番組織との差異(Flowの本番反映有無、本番Leadの外部ID未設定37件中31件)は本計画の対象外。

---

## 7. 実行前提として残る未確認事項(手順書8章より)

本書作成時点で、以下2点は**未確認のまま**である(手順書8.2・8.5: 連携用Integration Userでは確認不能、管理者ログインでの目視確認が必要と方針確定済み。本書作成にあたりSandboxへは接続していないため、新たな確認は行っていない)。

| # | 未確認事項 | 確認方法(管理者ログイン) | 未確認のままの場合の扱い |
|---|---|---|---|
| 1 | **Convert Leads権限**: 手動変換を担当する予定の人(実行者)がConvert Leads権限を持っているか | Setup → ユーザー → 該当ユーザーのプロファイル/権限セットで「リードの取引の開始(Convert Leads)」を確認 | Step 4(変換実行)に進まない。Step 1〜3は実施可 |
| 2 | **DoNotCall保持Flow** `DentShift_Preserve_Do_Not_Call_On_Convert`: (a) Activeバージョンの有無、(b) 発火条件、(c) 転記先 | Setup → フロー → 該当Flowのバージョン一覧と、Activeバージョンの開始条件・更新要素を目視。リポジトリ定義(`salesforce/force-app/main/default/flows/DentShift_Preserve_Do_Not_Call_On_Convert.flow-meta.xml`、`<status>Active</status>`、Lead After-Save Update、`$Record.ConvertedContactId` のContactの `DentShift_Do_Not_Call__c` をtrueに更新)と一致するか | (e)のみ保留。他シナリオは継続可 |

加えて本計画固有の前提:

| # | 前提 | 未充足の場合 |
|---|---|---|
| 3 | (d)用に、実行者以外の有効な人間ユーザーがSandboxに存在する(1.3) | (d)実施不可。ユーザー新規作成は本計画では行わない |
| 4 | 自動連携(`salesforceSync.ts`)がSandboxに対して稼働中でも、ダミー外部IDがアプリ側に存在しないため干渉しない(3.1) | 稼働状況にかかわらず実施可(念のため実施時刻を記録し、連携ログに `dryrun-mc-` が出ないことを事後確認) |

---

## 8. 本書で行わないこと

- Salesforce(Sandbox・本番)への接続・レコード作成・変換・更新・削除・設定変更(本書は計画のみ)。
- Flow/権限/重複ルール/ユーザーの作成・変更。
- ダミーレコードの削除(別途承認)。
- Owner割当ルール・医院重複統合要否の決定。

---

## 9. POへ提示する「対象と影響」一覧テンプレート

実変換(ダミー・本番とも)を実行する前に、以下を埋めてPOに提示し、承認を得る。本ドライランでは「計画値」列を本書の内容で埋め、実施後に「実績」列を記入する。

### 9.1 サマリ

| 項目 | 計画値 | 実績(実施後に記入) |
|---|---|---|
| 対象組織 | Sandbox `dsverify`(組織ID: `SALESFORCE_EXPECTED_ORG_ID` と一致を確認) | |
| 実行者(ログインユーザー) | 手動変換担当予定の管理者ユーザー | |
| 実施日時 | (承認後に決定) | |
| 変換を実行するLead件数 | 4件((a)(b)(e)(f)) | |
| 停止するLead件数(変換しない) | 2件((c)(d)) | |
| 新規作成されるAccount / Contact / Opportunity | 2 / 3 / **0** | |
| 既存レコード(ダミー以外)への変更 | **0件** | |
| 作成するダミーレコード(人手) | 12件(Lead 6 / Account 3 / Contact 1 / Task 1 / Event 1) | |
| 後片付け | 削除せず残す(削除は別途承認) | |
| 7章の未確認事項1(Convert Leads権限) | 未確認 / 確認済み(結果: ) | |
| 7章の未確認事項2(DoNotCall Flow) | 未確認 / 確認済み(Activeバージョン: 、発火条件: 、転記先: ) | |

### 9.2 Lead別一覧

| Lead名 | Lead Id | 外部ID(`DentShift_Clinic_Id__c`) | 変換先Account(既存Id / 新規) | 変換先Contact(既存Id / 新規) | 商談 | Lead Owner / 既存Account Owner | DoNotCall(Lead) | 活動件数(Task/Event) | 判定(変換 / 停止・理由) | 実績(ConvertedAccountId / ConvertedContactId / ConvertedOpportunityId) |
|---|---|---|---|---|---|---|---|---|---|---|
| 【DRYRUN-MC】Sa Lead | | dryrun-mc-20261003-sa-clinic | 既存(Sa) | 新規 | 作らない | 同一 | false | 0/0 | 変換 | |
| 【DRYRUN-MC】Sb Lead | | dryrun-mc-20261003-sb-clinic | 既存(Sb) | 既存(Sb, `…-sb-user`) | 作らない | 同一 | false | 0/0 | 変換 | |
| 【DRYRUN-MC】Sc Lead(外部ID未設定) | | (空) | — | — | — | — | false | 0/0 | **停止**: 6章項目2・8.3運用ルール | (未変換のまま) |
| 【DRYRUN-MC】Sd Lead | | dryrun-mc-20261003-sd-clinic | 既存(Sd, 別Owner) | — | — | **異なる** | false | 0/0 | **停止**: 6章項目4 | (未変換のまま) |
| 【DRYRUN-MC】Se Lead(電話禁止) | | dryrun-mc-20261003-se-clinic | 新規 | 新規 | 作らない | 同一 | **true** | 0/0 | 変換(Flow未確認なら保留) | |
| 【DRYRUN-MC】Sf Lead(活動あり) | | dryrun-mc-20261003-sf-clinic | 新規 | 新規 | 作らない | 同一 | false | 1/1 | 変換 | |

### 9.3 承認欄

| 項目 | 内容 |
|---|---|
| 承認者 | PO |
| 承認日 | |
| 承認範囲 | ダミーデータ作成(12件)/ 変換実行(4件)/ 両方 |
| 条件 | (例: 7章の未確認事項1を確認してから変換実行、等) |

---

## 10. 実施結果(2026-10-03、Sandbox dsverify、PO限定承認)

### 10.1 実施条件

| 項目 | 実績 |
|---|---|
| 対象組織 | Sandbox `dsverify`(組織ID先頭15桁 `00DBS000008Dj7Z`、`SALESFORCE_EXPECTED_ORG_ID`一致を接続時に確認、My Domainが`--dsverify.sandbox.`) |
| 実行者 | 木村正人(システム管理者、User Id `005d500000LC6C6AAL`)のChromeログインセッションで変換操作 |
| ダミー作成 | Account 3・Contact 1・Lead 6は連携ユーザー(dssync)のAPIで作成(`scripts/salesforce-dryrun-manual-conversion-sandbox.ts create`)。**連携ユーザーは電話禁止項目(`DentShift_Do_Not_Call__c`/`_Reason__c`)を書けず、Task/Eventにもアクセスできない**ため、Lead 5件+Contact 1件の電話禁止false化(根拠入力)とSfのTask/Event作成は管理者が画面で実施 |
| 7章未確認事項 | 1(Convert Leads権限)=確認済み(手順書8.7.1)、2(Flow)=確認済み(手順書8.7.2)。実施前に充足 |
| 既存レコードへの変更 | **0件**(ダミー以外の変換済みLead件数 6 → 6、Opportunity総数 16 → 16) |
| 件数 | Lead 35→41(+6)、Account 23→28(+3人手 +2変換)、Contact 20→24(+1人手 +3変換)、Opportunity 16→16 — 3.2節の計画値どおり |
| 後片付け | 削除していない(残置) |

### 10.2 Lead別実績

| シナリオ | Lead Id | 判定 | 実績(ConvertedAccountId / ConvertedContactId / ConvertedOpportunityId) | 確認結果 |
|---|---|---|---|---|
| (a) | `00QBS00000RPFU92AP` | 変換 | `001BS00001m7lVXYAY`(既存Sa、事前作成) / `003BS00000qyBibYAE`(新規) / null | ✓ 既存Accountに紐付き、Account外部ID不変、Contact `DentShift_Do_Not_Call__c=false`(Leadの値が対応付けで転記) |
| (b) | `00QBS00000RPFVl2AP` | 変換 | `001BS00001m7oqLYAQ`(既存Sb) / `003BS00000qyAjJYAU`(既存Sb Contact、`…-sb-user`) / null | ✓ 既存Contactに紐付き(新規Contactなし)、Contact外部ID不変、DoNotCall=false維持 |
| (c) | `00QBS00000RPCGA2A5` | **停止** | 未変換(IsConverted=false、外部IDnullのまま) | ✓ 期待どおり |
| (d) | `00QBS00000RPFM62AP` | **未検証** | 未変換 | Sd Account(`001BS00001m7aNcYAI`)のOwnerは実行者と同一で作成(第2の有効な人間ユーザーなし、無効ユーザーの有効化は行わない)。所有者差異の停止判断は未検証 |
| (e) | `00QBS00000RPFXN2A5` | 変換 | `001BS00001m7qFRYAY`(新規) / `003BS00000qyCWbYAM`(新規) / null | ✓ Contact `DentShift_Do_Not_Call__c=true`。ただし対応付け(Lead電話禁止→Contact電話禁止)でも同じ結果になるため、**Flowが働いた証明ではない**(2.5注意欄のとおり) |
| (f) | `00QBS00000RPFYz2AP` | 変換 | `001BS00001m7hNwYAI`(新規) / `003BS00000qyABPYA2`(新規) / null | ✓ Task「【DRYRUN-MC】Sf Task」・Event「【DRYRUN-MC】Sf Event」が変換先Contactの活動タイムラインに表示(管理者画面で確認。連携ユーザーはTask/Eventを参照できないためSOQLでは未確認) |

人手作成レコードのId一覧: `scripts/output/dryrun-mc-20261003-created.json`(gitignore対象、ローカル保管)。変換後SOQL結果: `scripts/output/dryrun-mc-20261003-after-conversion.txt`。

### 10.3 新たに判明した事項(計画時点で想定していなかったもの)

1. **新規Account作成で変換すると`DentShift_Clinic_Id__c`が空になる**((e)(f)で確認)。リード項目の対応付けで「DENT SHIFTの医院ID → なし」のため。アプリ同期はAccountを外部IDでupsertするため、この状態のAccountは同期から「存在しない」扱いになり、別Accountが作られる恐れがある。本番で手動変換する場合、**既存Accountを選ぶ**か、新規作成時は変換直後に外部IDを人が入力する手順(または対応付け設定の変更=設定変更のため別途承認)が必要。
2. 電話禁止・根拠はリード項目の対応付けでContactへ転記される(Flowとは独立)。この組織に標準項目`DoNotCall`は存在せず、営業リストビュー2件・アプリ同期ともカスタム項目のみを参照する(手順書8.7.2)。
3. 変換画面の「既存の取引先を選択」「既存の取引先責任者を選択」は、名称一致の自動候補が0件でも検索欄から任意の既存レコードを指定できる(外部IDで事前に特定したレコードを名称で検索して選ぶ運用が成立する)。
4. 検証ルール`DentShift_Do_Not_Call_Reason_Required`により、電話禁止をfalseにするには根拠の入力が必須(ダミーでは「【DRYRUN-MC】検証用ダミー(実在の同意ではない)」と入力)。

### 10.5 追加シナリオ(g): Flow動作証明(2026-10-03、PO承認で追加実施)

| 項目 | 内容 |
|---|---|
| 目的 | 既存Contact(`DentShift_Do_Not_Call__c = false`)+Lead(同 = true)を**既存Account/既存Contact**へ変換し、Flow `DentShift_Preserve_Do_Not_Call_On_Convert` が変換先Contactをtrueにすることと、架電対象リストから外れることを確認する。既存Contactへの変換では「リード項目の対応付け」は適用されない(新規作成時のみ)ため、trueになればFlow由来と判断できる |
| 作成(連携ユーザーAPI、`create-sg`) | Account `001BS00001m7jW0YAI`(外部ID `dryrun-mc-20261003-sg-clinic`)/ Contact `003BS00000qy3Q7YAI`(`DentShift_User_Id__c = dryrun-mc-20261003-sg-user`)/ Lead `00QBS00000RPHNt2AP`(外部ID同上、電話禁止=true(既定値)) |
| 管理者画面での準備 | Contact Sgの電話禁止をfalseに変更+根拠入力(検証ルールのため)。新規Account作成・設定変更は行っていない |
| 変換前(SOQL) | Contact Sg: false(根拠あり)。架電対象リストビュー条件(`DentShift_Do_Not_Call__c = false AND DentShift_User_Id__c != null`)に**該当** |
| 変換 | 管理者セッションで「取引の開始」→ 既存Account Sg・既存Contact Sg を検索して選択、「商談は作成しない」 |
| 変換後(SOQL) | Lead: IsConverted=true、ConvertedAccountId=`001BS00001m7jW0YAI`、ConvertedContactId=`003BS00000qy3Q7YAI`、ConvertedOpportunityId=null。**Contact Sg: `DentShift_Do_Not_Call__c = true`**(根拠文は残存)。架電対象リストビュー条件に**非該当**(SOQLで同条件を実行: ダミーではSb Contactのみ該当。管理者画面でリストビュー「DENT SHIFT Call Targets - Contact」(`00BBS000007rvDp2AI`)を開き、7件中ダミーはSb既存Contactのみ・Sgが含まれないことを目視確認)。Opportunity 16→16、ダミー以外の変換済みLead 6→6 |
| 結論 | **Flowは既存Contactへの変換で発火し、カスタム項目をtrueへ更新する**ことを確認。運用上の電話禁止(カスタム項目)は維持される。標準`DoNotCall`はこの組織に存在しないため対象外 |
| 補足 | Contact側の「電話禁止の解除・変更の根拠」はfalse時の文言のまま残る(Flowは根拠を書き換えない)。運用上「trueなのに解除根拠が残っている」状態になるため、根拠欄の扱い(Flowでクリアするか、人が追記するか)は別途判断 |

出力: `scripts/output/dryrun-mc-20261003-sg-created.json`、`scripts/output/dryrun-mc-20261003-sg-after-conversion.txt`(gitignore対象)。

### 10.4 本計画で未検証のまま残るもの

- (d) 所有者差異での停止判断(第2ユーザー不在)。
- ~~Flowの動作証明~~ → 10.5で確認済み。
- 本番組織での同一挙動(対応付け設定・Flow・検証ルールの本番反映状況は未確認)。

## 参照

- `docs/SALESFORCE_LEAD_MANUAL_CONVERSION_PROCEDURE_2026-10-03.md`(手順書、特に1・2・3・4・5・6・8章)
- `docs/SALESFORCE_SANDBOX_TEST_DATA_AUDIT.md`(既存Sandboxテストデータの命名: `【検証】`・`検証 院長`)
- `salesforce/force-app/main/default/flows/DentShift_Preserve_Do_Not_Call_On_Convert.flow-meta.xml`(Flow定義。配備状況は未確認)
- `src/domain/integration/salesforceCrmMapping.ts`(外部ID項目名・Lead/Account/Contact項目マッピング)
- `src/server/services/salesforceSync.ts`(`adoptConvertedRecord`: 変換後レコードへの外部ID付与)
