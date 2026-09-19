# 無料診断結果の正式統合 設計案 (2026-09-05)

> 2026-09-10追記: 本設計時点で別スコープとしていた`Clinic.contactEmail`と診断結果メールは、
> 後続実装で追加した。メールproviderは固定せず、既定値disabled・明示設定時のみResendへ
> 接続する。送信元ドメインを用いた実メール疎通は引き続き未完了。

対象: 「無料診断結果への正式統合」— 保存(DB) / API返却 / 結果画面表示。
**設計のみ。ユーザー承認前にコード変更は行わない。**

前提として `design/reference/dashboard/` の実画像5点、`docs/ui/DESIGN_SYSTEM.md`、
`docs/ui/DASHBOARD_UI_SPEC.md`、`docs/DATA_MODEL.md`、`docs/SECURITY.md`、
`docs/P0_ACCEPTANCE.md` を確認した上で本書を作成した。既存UIの視覚的正本(実画像)は
無視せず、後述のとおり「どこまでが今回のデータで再現可能か」を正直にGAPとして示す。

除外事項(今回は着手しない、と明示されたもの): Google実API接続 / 決済 / アンバサダー /
外部サイト自動変更 / P1・P2機能。

---

## 1. 現在の DiagnosisResult / APIレスポンス構造

### 1.1 サービス層の出力(`RunFreeDiagnosisResult`, `src/server/services/runFreeDiagnosis.ts`)

```
RunFreeDiagnosisResult {
  clinicName: string
  clinicUrl: string
  scoreBreakdown: DiagnosisScoreBreakdown   // 6領域100点
  competitors: CompetitorClinic[]           // 近隣競合(名前・URL・距離のみ)
  questionResults: PatientQuestionResult[]  // 患者質問別の勝敗
  topImprovements: ImprovementCandidate[]   // 改善TOP3(最大3件)
  adComplianceChecks: AdComplianceCheckResult // 医療広告AIチェック(全件)
  dataDisclaimer: string
  measuredAt: string
}
```

これは「1回の診断実行が計算した内容」の全体であり、DBへ保存する候補の母集合でもある。

### 1.2 POST /api/diagnosis (`src/app/api/diagnosis/route.ts`)

- リクエスト: `{ clinicName, clinicUrl, contactEmail, gbpUrl?, bookingUrl? }`
- 処理: `runFreeDiagnosis()` を実行 → `saveDiagnosisResult()` で保存 → **レスポンスは `{ diagnosisId }` のみ(201)**。
- **重要な現状**: `RunFreeDiagnosisResult` の中身(スコア・TOP3・医療広告チェック等)は
  レスポンスボディに一切含まれない。計算結果はいったんDBへ保存され、画面表示は
  別途 `diagnosisId` で読み直す方式になっている。

### 1.3 結果取得

- **専用のGET APIエンドポイントは存在しない**。
- `src/app/diagnosis/result/[id]/page.tsx` がNext.jsのServer Componentとして
  `getDiagnosisById(id)` を直接呼び出し、DBから読み直した内容をそのままHTMLとして
  サーバー側でレンダリングしている(クライアント側のfetchは発生しない)。
- `src/app/dashboard/page.tsx`(認証必須)は `getDiagnosesByClinicId(clinicId)` で
  医院の過去診断一覧(id / totalPoints / totalStatus / measuredAt のみ)を取得し、
  各行から `/diagnosis/result/[id]` へリンクしているだけ。

### 1.4 現在の結果画面の実装状態

`src/app/diagnosis/result/[id]/page.tsx` と `src/app/dashboard/page.tsx` は、
P0 vertical slice用にインラインstyleで組まれた**簡易プレースホルダー画面**であり、
`docs/ui/DESIGN_SYSTEM.md` / `DASHBOARD_UI_SPEC.md` / `design/reference/dashboard/`
の実画像とは配色・レイアウトともに一致していない(角丸カードのグリッド配置、
円形ゲージ、サイドナビ等は未実装)。今回の設計は「保存・API・画面に何を持たせるか」
を対象とし、実際のビジュアル実装(UIコンポーネント刷新)は別途ユーザー承認を得てから
着手する。

---

## 2. 現在DBに保存されている項目

`prisma/schema.prisma`(SQLite。Postgres移行前提でJSON構造はStringへ直列化)。

**Clinic**: id, name, url, gbpUrl, bookingUrl, createdAt
(※ `contactEmail` はDATA_MODEL.md正本の `clinics.contact_email` に相当するが、
現在のPrismaスキーマには存在しない。無料診断フォームで収集した `contactEmail` は
どこにも保存されていない — 3章で扱う)

**Diagnosis**: id, clinicId, totalPoints, totalStatus,
scoreBreakdownJson(`DiagnosisScoreBreakdown`丸ごと。criterion単位のevidence・
dataSource・measuredAtを含む), competitorsJson, questionResultsJson,
improvementTasksJson(`ImprovementCandidate[]`丸ごと。escalation/dataGap/
structuredEvidenceを含む), dataDisclaimer, measuredAt

**Contact** / **Session**: Step4認証用(医院側の「人」。患者情報ではない)。

ポイント: 既存の4つのJSON列は「集計後の値だけ」ではなく、ドメインオブジェクトを
丸ごと`JSON.stringify`しているため、criterion単位のevidence配列や
improvement候補のstructuredEvidence/escalation理由は**実は既にすべて保存されている**。
「保存されていない」のは主にモデル自体が存在しないもの(4章参照)。

---

## 3. 現在保存されていない項目

1. **`adComplianceChecks`(医療広告AIチェックの結果)** — `Diagnosis`モデルに対応する
   列が存在しない。findings(sourceType/provisional/sourceLabel/evidence含む)も
   disclaimerもcheckedAtも、DBには一切残らない(計算はされるが捨てられる)。
2. **`aiObservations`(AI別・質問別の生観測結果)** — `AiObservationResult[]`
   (どのAI(chatgpt/gemini)が、どの質問で、医院に言及したか/推薦順位/根拠テキスト/
   dataSource)は `runFreeDiagnosis()` 内部で計算され `questionResults` の算出に
   使われるが、**`RunFreeDiagnosisResult`にすら含まれず**、そのまま破棄される。
   「なぜこの勝敗判定になったか」をAI単位まで遡って説明する材料が失われている。
3. **診断行単位の構造化された「サンプル/実測」フラグ** — 現状、mock由来かどうかを
   示すのは自由記述の`dataDisclaimer`文字列1本のみ。criterion単位の`dataSource`
   フィールドはJSON内に埋もれており、DBクエリや一覧表示で「この診断はサンプルを
   含むか」を機械的に判定できない(JSONを全件パースしないと分からない)。
4. **`contactEmail`(無料診断フォームで収集したメールアドレス)** — `Clinic`モデルに
   列がなく、`saveDiagnosisResult()`の引数として渡されているにもかかわらず破棄される。
   P0_ACCEPTANCE.mdの「メールで結果を受け取れる」を満たすには送信先メールアドレスの
   永続化が必要になるが、メール送信の仕組み自体(`RESEND_API_KEY`は`.env.example`で
   未使用のままコメントアウト)がまだ存在しないため、**今回の設計の主眼(保存・API・
   画面表示)からは切り離し、別途の意思決定事項として8章の手前で扱う**。
5. **計測条件のスナップショット(`measurement_condition`)** — DATA_MODEL.md正本が
   想定する「使用AI・地域・日時等の計測条件」を構造化して保持する列がない。現状は
   `dataDisclaimer`という自由文と`measuredAt`のみ。

---

## 4. P0で永続化すべき診断結果

「診断結果を再現・説明できるために必要なevidenceとmeasurement metadata」という
今回の要件に沿って、以下を優先度付きで提案する。

### 4.1 そのまま維持(変更不要)

scoreBreakdown / competitors / questionResults / topImprovements / dataDisclaimer /
measuredAt — 既にドメインオブジェクト丸ごと保存されており、evidenceも含めて
再現性は満たされている。

### 4.2 新規に永続化すべき(今回のスコープの中心)

- **`adComplianceChecks`丸ごと**(findings[].sourceType/provisional/sourceLabel/
  evidence[].sourceType含む、disclaimer、checkedAt)。医療広告AIチェックの実装が
  完了している以上、これを保存しないままでは「無料診断結果への正式統合」が
  成立しない。
- **`isSample`(診断行レベルの機械判定可能なサンプルフラグ)**。
  criterion単位の`dataSource`・ad-complianceの`sourceType`・(後述の`aiObservations`
  を保存する場合はその`dataSource`)のいずれかに`"mock"`が1件でも含まれていれば
  `true`。JSONを都度パースしなくても一覧表示・監査・将来の実績集計から
  「サンプル診断」を機械的に除外できるようにする(P0_ACCEPTANCE.mdの
  「サンプル/mockデータを実績として表示していない」をDBレベルでも担保する)。
  `docs/DATA_MODEL.md`が既に`diagnoses.is_sample`として正本で定義している概念に
  合わせた命名。

### 4.3 追加提案(要ユーザー承認・スコープ拡張になるため独立した意思決定事項とする)

- **`aiObservations`(AI別・質問別の生観測結果)をサービス層の戻り値・保存対象に
  追加する**。理由: 「診断結果を再現・説明できるためのevidence」を厳密に満たすには、
  `questionResults`の`evidence: string[]`(自由文)だけでなく、どのAIが・どの
  質問で・言及の有無/推薦順位/dataSourceがどうだったかを遡れる必要がある。
  これは3章2項で述べたとおり現状完全に破棄されているため、今回の統合作業の対象に
  含めるかどうかをユーザーに確認したい(含める場合は`RunFreeDiagnosisResult`への
  フィールド追加が必要になり、元のvertical sliceのスコープをわずかに広げるため)。
  → **未承認の場合はスキップ可能**。その場合、患者質問別勝敗の「根拠」は現状の
  自由文evidenceのみで説明する、という制約を明示的に受け入れることになる。

### 4.4 保存する場合の個人情報除外の再確認

医療広告AIチェックのevidenceは既に(a) review_response_pii以外は非マスキング、
(b) PIIは`[個人情報を検出: ...]`へ置換、(c) 120文字で切り詰め、を経た後の状態を
保持する設計になっている(実装済み)。`aiObservations`を保存対象に追加する場合も、
`evidence`フィールドは「患者の相談内容や個人を特定できる引用」を含まない
(あくまで医院サイト・GBP等の医院側公開情報に対する所見)ことをテストで担保する。

---

## 5. 保存しなくてよい一時データ

- providerが内部的に使う生の乱数シード・HTTPレスポンス全文など、evidence化されて
  いない中間データ。将来の実プロバイダーでも「観測結果として意味のある要約」だけを
  `evidence`/`observedValue`として保持し、生ペイロードは保存しない方針を維持する。
- `AdComplianceCheckInput.reviewResponseTexts`の**生の入力テキストそのもの**。
  永続化するのはPIIマスキング・120文字切り詰め後の`evidence[].quotedText`のみで、
  マスキング前の生テキストを別途どこかに保存することはしない(追加条件5の徹底)。
- セッション内でしか意味を持たない値(HTTPリクエストヘッダ、リクエストID等)。
- 将来、競合サイトをスコアリングするようになった場合でも、競合サイトの全文コピー
  等は保存せず、evidence化した要約のみを保持する(現状は競合の名前・URL・距離のみ
  でこの論点自体は未発生)。

---

## 6. Prisma schemaの変更案

追加のみ(既存列の削除・リネームなし、破壊的変更なし)。

```prisma
model Diagnosis {
  id                   String   @id @default(cuid())
  clinicId             String
  clinic               Clinic   @relation(fields: [clinicId], references: [id])
  totalPoints          Int
  totalStatus          String
  scoreBreakdownJson   String
  competitorsJson      String
  questionResultsJson  String
  improvementTasksJson String
  dataDisclaimer       String
  measuredAt           DateTime @default(now())

  // 追加分(2026-09-05 無料診断結果への正式統合)
  adComplianceChecksJson String  @default("{\"findings\":[],\"disclaimer\":\"\",\"checkedAt\":\"\"}")
  isSample               Boolean @default(true)

  // 4.3が承認された場合のみ追加
  // aiObservationsJson  String?
}
```

- `adComplianceChecksJson`に`@default`を付けるのは、既存の(移行前に作成済みの)
  診断行に対してマイグレーション時にNOT NULL制約で失敗させないため。実際には
  今回の変更と同時にアプリを更新すればこの分岐は発生しないが、SQLiteの
  `ALTER TABLE ADD COLUMN`はデフォルト値必須のため安全側に倒す。
- `isSample`のデフォルトは`true`。P0はここまで全てmock providerのみで動いてきた
  ため、**既存行を`true`にすることは事実として正しい**(後から実測データが混ざる
  行が出てきた時点で、その行だけ`false`になる)。
- `Clinic`モデルへの`contactEmail`追加(DATA_MODEL.md正本の`clinics.contact_email`)
  は、4章で述べたとおりメール送信機能自体が別スコープのため、**今回のPrisma変更案
  には含めない**(ユーザーが望む場合は別途追加を提案する)。

---

## 7. DiagnosisRepositoryの変更案

`src/server/db/diagnosisRepository.ts`(既存の関数シグネチャは変更しない)。

- **`saveDiagnosisResult()`**: `data`に
  `adComplianceChecksJson: JSON.stringify(result.adComplianceChecks)`と
  `isSample: result.isSample`を追加するだけ。`isSample`の**計算自体はrepositoryでは
  行わない**(JSON文字列を持ってきてパースし直すのは責務が逆転するため)。
  `RunFreeDiagnosisResult`に`isSample: boolean`フィールドを追加し、
  `runFreeDiagnosis()`(サービス層。criterion/finding/(該当すれば)aiObservationの
  dataSource/sourceTypeを既に手元に持っている)側で計算して埋める。
- **`getDiagnosisById()`**: 戻り値に`adComplianceChecks: JSON.parse(...)`と
  `isSample`を追加する。
- **`getDiagnosesByClinicId()`**: `select`に`isSample`を追加する(一覧行に
  「サンプル」バッジを出すため。JSON列は引き続き選択しない=一覧のクエリコストを
  増やさない)。
- 新規ヘルパーは追加しない(既存の3関数の戻り値を拡張するのみ)。

---

## 8. POST /api/diagnosis のレスポンス変更案

**現状維持を推奨**: `{ diagnosisId }`のみを返す形は変えない。

理由: 現在の画面遷移は「POST→`diagnosisId`を受け取る→
`/diagnosis/result/[id]`へリダイレクト→Server Componentが`getDiagnosisById()`で
直接DBを読む」という構成であり、POSTレスポンス自体に診断内容を含める必要が
実装上ない。ここで診断内容を返す公開APIレスポンスに変えると、

- `diagnosisId`は認証なしで結果画面にアクセスできる設計(SECURITY.md「無料診断は
  メールアドレスのみで完結」の思想どおり)なので問題ないが、POSTのレスポンス
  ボディという別チャネルにも同じ内容を载せる意味が薄く、
- 将来的に本当に外部(モバイルアプリ等)向けの公開JSON APIを用意する場合は、
  9章のGET構造をそのまま`GET /api/diagnosis/[id]`として切り出す方が筋が良い
  (Server Component用の内部データ取得と外部公開APIを最初から一致させておく)。

→ **今回はPOSTレスポンスの形は変更しない**。GET用の公開JSON APIを新設するかどうかは
「P0で必要か」の意思決定事項として9章末尾に切り出す。

---

## 9. GET診断結果のレスポンス構造

`getDiagnosisById()`の戻り値(=Server Componentが使うデータ、将来GET APIを
新設する場合も同一シェイプを再利用する)を以下のとおり拡張する。

```
{
  clinicId: string
  clinicName: string
  clinicUrl: string
  totalPoints: number
  totalStatus: string
  scoreBreakdown: DiagnosisScoreBreakdown
  competitors: CompetitorClinic[]
  questionResults: PatientQuestionResult[]
  topImprovements: ImprovementCandidate[]
  adComplianceChecks: AdComplianceCheckResult   // 追加
  isSample: boolean                              // 追加
  dataDisclaimer: string
  measuredAt: Date
}
```

**意思決定事項**: 現時点では`GET /api/diagnosis/[id]`という独立した公開JSON APIは
新設しない(Server Componentの直接DB読み取りのみで完結させる)ことを提案する。
理由は、`diagnosisId`(cuid、推測困難)を知っていれば誰でも読めるという現行の
設計方針自体は無料診断のUXとして正しいが、これを**汎用JSON APIとして切り出すと
第三者による走査・収集の対象になりやすい**(現状はNext.jsのServer Componentが
HTMLを都度生成するだけなので、機械的なJSON収集の的になりにくい)。公開APIが
本当に必要になるタイミング(自社モバイルアプリ、外部埋め込みウィジェット等)で
改めてレート制限等とセットで設計する方が安全と考える。ユーザーの意向を確認したい。

---

## 10. 診断結果画面に表示する情報構成

無料診断結果ページ(`/diagnosis/result/[id]`)は**未認証の単発スナップショット**
であり、`DASHBOARD_UI_SPEC.md`が定義する**認証後の継続利用ダッシュボード**
(`/dashboard`、前回比較・タスク管理・複数回の推移を前提)とは性質が異なる。
実画像・仕様書のカード構成を「今回のデータで再現できる範囲」に翻訳すると
以下になる(視覚実装=コンポーネント刷新は別途承認後)。

1. **ヘッダー**: 医院名 / 測定日時 / disclaimerバナー(既存維持)。
2. **総合集患スコア**: `scoreBreakdown.totalPoints`。実画像の円形ゲージの
   視覚言語(数字を大きく、状態を色だけで判断させない)は踏襲するが、
   「前回比」は今回のデータでは扱わない(11章参照、単発診断には前回がない)。
3. **6領域スコア**(AIO/MEO/SEO/LLMO/予約導線/口コミ): `scoreBreakdown.domains`。
   実画像のアイコン付きタイル+バーの構成に合わせられる(データは揃っている)。
   `status`が`unavailable`の領域は「取得不能」、`estimated`は「推定」を明示。
4. **近隣競合**: `competitors`(名前・URL・距離のみ)。実画像の「商圏競合比較」
   棒グラフ(自院72/競合A58/…)は**競合側の総合スコアを持っていないため今回のデータ
   では再現不可**(14章のGAP参照)。今回は「近隣の競合医院リスト」として表示する
   に留め、棒グラフ化はしない。
5. **患者質問別の勝ち負け**: `questionResults`。実画像のカード2にほぼ一致。
6. **なぜ負けている?**: `topImprovements`のうち`kind: "data_gap"`または
   `kind: "standard"`の候補から構成する(現状はTOP3=最大3件しか保持していないため、
   カード3が意図する「複数の敗因候補の一覧」を厚めに見せたい場合はTOP3選定前の
   候補集合をどこまで保持・表示するかという別の意思決定が必要になる。今回は
   「TOP3に入った範囲でのみ表示する」を既定案とし、広げる場合はユーザー承認を得る)。
7. **今月やるべきこと TOP3**: `topImprovements`。優先度・担当(`recommendedAssignee`)・
   根拠(`detectedFact`/`structuredEvidence`)を表示。「完了状態」「再計測日」は
   タスク管理機能(DATA_MODEL.md `improvement_tasks`テーブル、状態遷移FSM)が
   前提のP1機能のため今回は表示しない。
8. **医療広告AIチェック**(新規セクション。既存の実画像・仕様書には存在しない
   ため、今回追加する): `adComplianceChecks.findings`をカテゴリ別に表示。
   各所見に severity/confidence/displayMessage/evidence/sourceLabel、
   `provisional`な所見は「開発用サンプル」バッジ付きで視覚的に区別する。
   末尾に`disclaimer`(3文言)を必ず表示。
9. **この医院を管理する**(既存の signup CTA。維持)。
10. **フッターdisclaimer**(既存維持)。

---

## 11. TOP3と医療広告AIチェックの重複表示ルール

`escalationEligible: true`の医療広告AIチェック所見は、(a) 改善TOP3に
`legal_medical_ad_privacy`エスカレーション候補として現れ、かつ(b) 医療広告AI
チェックセクションの全件一覧にも現れる(実装済みの設計どおり、後者は前者を
含む全所見の一覧のため)。同じリスクが2箇所に別々の問題として表示されると
誤解を招くため、以下のルールを提案する。

- **両方に表示する**(どちらかを非表示にはしない)。TOP3は「今すぐやること」の
  行動リスト、医療広告AIチェックは正本§13.2が要求する「検出箇所/リスク区分/
  理由/修正候補/院長・法務確認の要否」を満たす完全な所見台帳、という**役割が違う**
  ため。
- 医療広告AIチェックセクション側で、`escalationEligible: true`の所見に
  「改善TOP3に反映済み」の小さなバッジを付ける(逆にTOP3カード側は現状のまま、
  タイトルに「医療広告AIチェックで検出」の一言が既に入っている設計を維持)。
- 対応関係は`finding.id`と`topImprovements[].key`(`ad-compliance-${finding.id}`)
  で機械的に突き合わせられる(既存実装のまま、データモデルの変更は不要)。
- 逆方向(severity=medium/low、またはsourceType=mockでTOP3に入らない所見)は
  医療広告AIチェックセクションにのみ表示され、TOP3には一切現れない(既存の
  escalation設計どおり)。

---

## 12. mock / estimated / measured / unavailable の表示ルール

既存のステータス体系を、`DASHBOARD_UI_SPEC.md`が要求する状態語彙
(loading/success/empty/**not_configured**/**needs_reauth**/
**temporarily_unavailable**/insufficient_data/error)に対応付ける。

| 既存の概念 | 対応する表示状態 | 現状の粒度 |
|---|---|---|
| `CriterionStatus: measured` | success(実測) | ○ |
| `CriterionStatus: estimated` | success(推定バッジ付き) | ○ |
| `CriterionStatus: unavailable` | insufficient_data / not_configured / temporarily_unavailable のいずれか | **△ 現状は3つを区別できず"unavailable"の1種類のみ** |
| `DataSource: mock` | サンプルであることを常に明示 | ○(criterion単位のみ。診断行レベルは4章の`isSample`で補う) |
| `AdRiskFindingSourceType: mock` | 「開発用サンプル」バッジ(`sourceLabel`を使用) | ○ 実装済み |
| `AdRiskFinding.provisional` | mock由来のみtrue | ○ 実装済み |

**GAP**: `unavailable`が「未接続(not_configured。例: gbpUrl未入力)」なのか
「一時的に取得失敗(temporarily_unavailable。例: API障害)」なのか
「そもそもデータが存在しない(insufficient_data)」なのかを、現在の
`CriterionStatus`型は区別していない。P0の無料診断は現状すべて成功/未接続の
どちらかしかあり得ない(実プロバイダー未接続のため「一時的失敗」は原理的に
発生しない)ため実害はまだ小さいが、`DASHBOARD_UI_SPEC.md`が明確にこの3つを
分けて表示するよう求めている以上、GAPとして記録しておく。

**提案(任意・今回必須ではない)**: `CriterionStatus`自体は変更せず、
`CriterionScore`に任意の`unavailableReason?: "not_configured" | "temporarily_unavailable" | "insufficient_data"`
を追加すると後方互換のまま将来の実プロバイダー接続時に自然に埋められる。
今回のスコープに含めるかはユーザー判断。

**普遍原則(再確認・既存で担保済み)**:
- 取得不能を「0」として表示しない(scoring.tsで構造的に保証済み)。
- mock/estimated値をmeasuredと同じ見た目(色・強調)にしない。実画像のような
  大きく太い青文字は「確信度の高い実測値」向けの表現であり、P0時点では
  ほぼ全項目が estimated/mock であるため、視覚言語(色・カード形状・タイポグラフィ)
  は実画像を踏襲しつつ、`DESIGN_SYSTEM.md`の「状態を色だけで判断させない」原則
  どおり控えめな推定/サンプルバッジを添えることで両立させる。

---

## 13. sourceType / provisional のUI表示ルール

**重要な注意**: `ImprovementCandidate.provisional`(45項目カタログとの対応が
未確定、という意味)と`AdRiskFinding.provisional`(mock由来で実測ではない、
という意味)は**同名だが全く別の概念**である。実装上混同していないが、
UI/コピーライティングで同じバッジ文言を使うと「この項目はカタログ対応が
未確定」なのか「これは開発用サンプル」なのかが院長に伝わらなくなる。

- `ImprovementCandidate.provisional`は院長向け画面には**出さない**
  (既存の設計方針どおり、監査・内部トレーサビリティ用途に留める)。
- `AdRiskFinding.provisional === true`の所見には、`sourceLabel`
  (「開発用サンプル(実測ではありません)」)をそのままバッジ文言として使う。
  この所見は severity が high でも「要対応」的な強い視覚表現(赤・太字等)を
  与えない(サンプルであることが伝われば十分)。
- `sourceType`という技術用語(enum値の生文字列: "mock"/"rule_based"等)は
  `DESIGN_SYSTEM.md`「専門用語を前面に出さない」原則により**院長向け画面には
  一切出さない**。常に`sourceLabel`(人間可読な既存実装済みの文言)経由で表示する。
  `dataSource`(criterion側、同じ役割)についても同様に生の enum 値ではなく
  既存の「(推定)」「取得不能」ラベルを使う。
- `sourceType`/`dataSource`の生値はDB・API(内部利用)層にのみ残し、監査・
  デバッグ・将来の実績集計フィルタ(`isSample`)にのみ使う。

---

## 14. 既存ダッシュボード正本画像との対応(GAP表)

`DASHBOARD_UI_SPEC.md`の構成要素ごとに、現在のデータモデルで再現できるかを
正直に整理する(○=今回のデータで再現可能、△=部分的、✗=データが存在せず
別途追加実装が必要)。

**上段(医院名/総合スコア/前回比/商圏順位/AI選ばれている割合/今月の優先改善/
スペシャリスト相談CTA)**
- 医院名 ○ / 総合スコア ○
- 前回比 ✗ — 同一clinicIdの前回`Diagnosis`行との差分計算が未実装(単発の無料
  診断結果ページでは「前回」という概念自体が本来存在しない。再診断・会員登録後の
  `/dashboard`側の機能として別途検討)
- 商圏順位 ✗ — 競合側の総合スコアを算出する仕組みがない(後述)
- AIで選ばれている割合(Share of Voice %) ✗ — `P0_ACCEPTANCE.md`が要求する
  項目だが、現状`questionResults`は勝敗の3択+insufficient_dataのみで、
  「%」としてのシェア算出ロジックはどこにも実装されていない(4.3の
  `aiObservations`を保存・集計対象にしても、%算出ロジック自体は別途必要)
- 今月の優先改善 ○(`topImprovements[0]`)
- スペシャリスト相談CTA ✗ — 予約・商談導線が未実装。既存の「無料会員登録」
  CTAとは別物(今回スコープ外)

**メインカード1(AIで選ばれている割合、自院/競合/AI切替、テーマ/エリアフィルタ)**
✗ — `aiObservations`をAI別に保存・集計する必要があり、フィルタUIも含め
今回のスコープを大きく超える(P1相当)。

**メインカード2(患者質問ごとの勝ち負け)** ○ — `questionResults`でほぼ一致。

**メインカード3(なぜ負けている? 根拠/影響度/確度/対象URL)** △ —
`dataGap`種別の候補と`structuredEvidence`で大枠は満たせるが、「対象URL」は
`CriterionEvidence.sourceUrl`(任意項目、現状mock providerは未設定)に依存する。

**メインカード4(今月やるべきこと、優先度/想定工数/担当/完了状態/再計測日)** △ —
優先度○・担当○。想定工数✗(現行の4軸に「工数」に相当する軸がない。
`easeOfExecution`軸はあるが「実行容易性」であり工数見積もりとは別概念)。
完了状態✗・再計測日✗(タスク管理FSM、DATA_MODEL.md `improvement_tasks`
テーブルが前提のP1機能)。

**メインカード5(AIから予約までのファネル)** ✗ — GA4/予約システム連携が前提
(Google実API接続。今回明示的に除外)。

**サイドナビ** — 今回対象の無料診断結果ページ(未認証・単発)には**適用しない**。
認証後の`/dashboard`は現状サイドナビ自体が未実装(プレースホルダーの一覧表示のみ)
であり、これは「無料診断結果への統合」とは別の、ダッシュボードUI刷新という
独立したテーマとして扱うべきと考える。

**状態表示(8種)** △ — measured/estimated/unavailableは持っているが、
not_configured/needs_reauth/temporarily_unavailable/errorの区別がない
(12章のGAPと同じ)。`needs_reauth`はGoogle等のOAuth連携が前提のため
今回のスコープでは発生しえない。

**結論**: 実画像のうち「6領域スコア」「患者質問別勝敗」「今月の優先改善(TOP3)」
「近隣競合の存在表示」は今回のデータで概ね再現できる。それ以外(前回比較・
商圏順位・AI選ばれている割合%・マルチAIモニタリング・予約ファネル・タスク完了
管理)は、Google実API接続やP1/P2機能と密接に絡むため、**今回は「まだ実装しない」
明示的なGAPとして残し、独自の代替デザインを作らない**(=それらの枠自体を
今回は設けない/簡略表示に留める)ことを提案する。

---

## 15. migration方針

- **追加のみ・破壊的変更なし**。既存列の削除・型変更・リネームは行わない。
- 新規: `Diagnosis.adComplianceChecksJson`(デフォルト値付き文字列)、
  `Diagnosis.isSample`(デフォルト`true`)。(4.3が承認されれば
  `aiObservationsJson`も同様に追加、null許容またはデフォルト`"[]"`)
- 実行コマンド(ユーザーのMac実機で実行。本セッションのサンドボックスでは
  `npm install`/DB接続系コマンドは実行しない、という既存の運用方針を踏襲):
  `npx prisma migrate dev --name add_ad_compliance_and_sample_flag`
- 既存行のバックフィルは不要(デフォルト値で整合する。過去の診断行は
  「医療広告AIチェック結果なし」「isSample=true」として扱われるのは事実として正しい)。
- Postgres移行時は、`schema.prisma`冒頭に既に書かれている方針どおり、
  `adComplianceChecksJson`等のString列を`Json`型に変え直す(今回はSQLiteのまま
  変更しない)。

---

## 16. unit / integration test方針

- **`RunFreeDiagnosisResult.isSample`の計算ロジック**を`runFreeDiagnosis.test.ts`
  に追加: 全criterion/finding(該当すれば`aiObservations`)が非mockなら`false`、
  1件でもmock/sourceType="mock"を含むなら`true`になることを検証する
  (P0では実質的に常に`true`になるが、ロジックとして「なぜtrueなのか」を
  境界値で担保する)。
- **`buildAdComplianceResult`との結合**: `adComplianceChecks`が空配列でも
  正しくシリアライズ・デシリアライズできること(既存の空配列テストを踏襲)。
- **DiagnosisRepositoryのラウンドトリップテスト(新規追加が必要)**: 現状
  `tests/`配下には**Prisma/DBに触れるテストが1件も存在しない**
  (既存の7ファイルはすべてfakeプロバイダーを使った純粋なドメイン/サービス層
  テスト)。今回`adComplianceChecksJson`/`isSample`の保存・復元を検証するには、
  初めてDBテストの仕組みを持ち込むことになる。方式の選択肢:
  - (a) テスト用SQLite(`file:./test.db`または`:memory:`相当)を都度作成し、
    `saveDiagnosisResult`→`getDiagnosisById`のラウンドトリップで
    `escalationEligible`/`provisional`/`sourceType`がJSON往復後も壊れていない
    ことを検証する。
  - (b) Prisma自体はモックし、`JSON.stringify`/`JSON.parse`の往復のみを
    純粋関数レベルで検証する(DBテスト基盤を増やさない代わりに、実際の
    Prismaスキーマとの整合は手動確認に頼る)。
  **どちらの方式を採るかは、テスト基盤を新規に持ち込むかどうかの意思決定
  そのものなので、実装着手前にユーザーに確認したい**。
- 既存の136件は今回の変更で壊れないことを確認する(型追加はすべて既存
  フィールドへの追加であり、既存ロジックの分岐は変更しない)。

---

## 17. 変更予定ファイル

- `prisma/schema.prisma`(列追加)
- Prisma migrationファイル(`npx prisma migrate dev`実行時に自動生成、
  ユーザーのMac実機で実行)
- `src/server/db/diagnosisRepository.ts`(3関数の入出力拡張)
- `src/server/services/runFreeDiagnosis.ts`(`isSample`計算・戻り値への追加。
  4.3承認時は`aiObservations`の戻り値追加も)
- `src/app/api/diagnosis/route.ts`(変更なしを推奨。8章参照)
- `src/app/diagnosis/result/[id]/page.tsx`(医療広告AIチェックセクション追加、
  `isSample`バッジ表示。※視覚デザインそのものの刷新は別途承認が必要な独立
  スコープとし、今回はデータの表示可否のみを対象とする)
- `src/app/dashboard/page.tsx`(一覧行に`isSample`バッジ追加。同上、視覚刷新は
  対象外)
- テスト: `tests/unit/runFreeDiagnosis.test.ts`(`isSample`テスト追加)、
  新規DBテスト(16章の方式が決まり次第追加)
- 変更しない: `src/domain/ad-compliance/*`(前回までで完成済み)、
  Google実API・決済・アンバサダー・外部サイト自動変更に関わる一切のファイル

---

## まとめ: 実装着手前にユーザーの判断を仰ぎたい点

1. **4.3 / 17**: `aiObservations`(AI別・質問別の生観測結果)を今回のスコープに
   含めて保存・戻り値に追加するか。含めない場合、患者質問別勝敗の根拠説明は
   現状の自由文evidenceのみに留まる。
2. **8 / 9**: `GET /api/diagnosis/[id]`のような公開JSON APIを新設するか、
   それとも今回はServer Componentの直接DB読み取りのみで完結させるか。
3. **10章6項**: 「なぜ負けている?」カードをTOP3(最大3件)の範囲に限定するか、
   TOP3選定前のより広い候補集合まで表示範囲を広げるか。
4. **12章**: `CriterionScore.unavailableReason`(not_configured/
   temporarily_unavailable/insufficient_dataの区別)を今回のスコープに含めるか。
5. **16章**: DiagnosisRepositoryのテストで実際にSQLiteへ読み書きするテストを
   新規に持ち込むか、JSON往復のみを純粋関数レベルで検証するに留めるか。
6. **4章4節・10章**: 実際の画面刷新(実画像の角丸カード・円形ゲージ等の
   ビジュアル実装)は、本設計(データの保存・API・表示可否)とは別の承認事項
   として切り出してよいか。

上記いずれも、今回の設計の骨格(2〜7章・11〜13章)には影響しない付帯的な
選択肢のため、まずは本書の設計方針全体についてご確認いただき、承認後に
1〜6の各点を個別に決めながら実装を進める、という進め方を想定している。
