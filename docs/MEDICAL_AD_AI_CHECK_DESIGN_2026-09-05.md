# 医療広告AIチェック(P0) — 設計提案(コード変更前レビュー)

作成日: 2026-09-05
根拠資料: `docs/source/DENT_SHIFT_機能要件定義書_Ver2.1_ヒートマップ追加.md` §13(医療広告・コンプライアンスチェック)、§11.2(改善アクションの優先度、法令・個人情報リスクの最優先繰り上げ)、§21(非機能・安全要件)、`docs/GAP_ANALYSIS_2026-09-04.md` D節(P0未実装機能)
既存実装: `src/domain/improvement-task/`(改善TOP3ロジック、`legal_medical_ad_privacy`エスカレーションカテゴリ、REVIEWS.policy_riskクライテリオン)

**このドキュメントは設計提案のみです。承認をいただくまでコード変更は行いません。**

---

## 前提の確認

正本§13は検出対象(13.1)と出力(13.2)を定義していますが、テキスト解析の具体的アルゴリズム・しきい値は定義されていません。したがって、以下の設計はGAP分析・改善TOP3ロジックと同様に、正本の意図を汲んだ**暫定実装方針**であり、確定仕様ではありません。P0はmock providerでの動作を前提とし、実際のページ本文・口コミ返信文を解析する本番ロジックは実プロバイダー接続後に差し替える前提です(=改善TOP3で採用した「domain/provider分離」パターンをそのまま踏襲します)。

---

## 1. 現在未実装の医療広告AIチェックの範囲

現状、`src/domain/improvement-task/candidateCatalog.ts`にはREVIEWS領域の3項目(`reviews-response-contains-pii`, `reviews-exaggerated-claims`, `reviews-incentivized-reviews`)が`legal_medical_ad_privacy`エスカレーション対象として存在しますが、これらは**口コミへの対応**という限定的な範囲のみで、かつmockのcriterion達成率(`REVIEWS.policy_risk`)というスコアベースの間接判定に留まっています。

正本§13が求める「医療広告・コンプライアンスチェック」は、口コミ返信だけでなく**医院サイト本文(診療ページ、LP、自由診療ページ等)・広告文・体験談・ビフォーアフター掲載箇所**まで含めた、テキスト内容そのものに対する検査です。現時点ではこの本文検査の仕組み自体が存在しません。今回の設計は、この「テキスト内容ベースの検査」という未実装部分を埋めるものです。

## 2. P0でチェックすべきリスクカテゴリ

正本§13.1の9項目を、判定・表示の粒度を上げるためご指示の11分類に対応させます(正本の項目を分割しているだけで、範囲の追加はありません)。

| # | category key(案) | 内容 | 正本§13.1との対応 |
|---|---|---|---|
| 1 | `superlative_exaggeration` | 最上級・誇大表現(例:「絶対に治る」「日本一」「必ず成功」) | 比較優良・最上級表現(前半) |
| 2 | `comparative_superiority` | 比較優良表示(他院より優れているという名指し・暗示の比較) | 比較優良・最上級表現(後半) |
| 3 | `safety_assertion` | 安全性の断定(例:「痛みは一切ありません」「絶対安全」) | 効果・安全性の断定(前半) |
| 4 | `efficacy_assertion` | 効果の断定(例:「必ず白くなります」) | 効果・安全性の断定(後半) |
| 5 | `unfounded_numbers` | 根拠のない数値(出典のない「成功率99%」等) | 根拠のない数値 |
| 6 | `self_pay_disclosure_gap` | 自費診療の費用・期間・リスク等の情報不足 | 費用・期間・リスクの不足/自由診療の必要事項不足 |
| 7 | `patient_testimonial` | 患者体験談の広告利用 | 患者体験談の広告利用 |
| 8 | `before_after_gap` | ビフォーアフターの説明不足(個人差注記・治療内容/期間/費用の併記なし) | ビフォーアフターの説明不足 |
| 9 | `review_incentive` | 口コミインセンティブ・選別依頼 | 口コミインセンティブ、選別依頼 |
| 10 | `review_response_pii` | 個人情報を含む口コミ返信 | 個人情報を含む口コミ返信 |
| 11 | `other_general_risk` | その他、歯科医院サイトで重要な医療広告上のリスク(自由記述) | (正本に明記なし。将来のカテゴリ追加の受け皿として新設) |

`other_general_risk`は、AIが上記10分類に当てはまらないが医療広告ガイドライン上気になる表現を検出した場合の受け皿です。この分類は**常に「要確認」表示のみとし、severityを`high`にはしない**設計にします(未分類のAI判定を重大リスクとして自動的にTOP3へ繰り上げることは避けるため)。

## 3. 各カテゴリの検出条件(P0/mock方針)

正本には検出アルゴリズムの定義がないため、改善TOP3のcatalogPriority/rippleHint同様、**カテゴリごとに「検出のきっかけとなる入力データ」と「検出ロジックの所在」を定義し、実際の文字列解析ロジックはprovider層(mock→実プロバイダーで差し替え)に閉じ込める**方針とします。domain層はprovider実装がすでに出力した`AdRiskFinding`を検証・整理するだけで、正規表現や文言リストなどの非決定的・実装依存のロジックを一切持ち込みません(改善TOP3の「domain層に乱数を持ち込まない」原則と同じです)。

| category key | P0でチェックする入力データ | 検出ロジックの所在(想定) |
|---|---|---|
| superlative_exaggeration / comparative_superiority / safety_assertion / efficacy_assertion / unfounded_numbers | 医院サイト本文(トップページ・診療ページのテキスト) | provider: 禁止表現・パターン辞書とのマッチング(将来的にLLM分類へ置き換え可能) |
| self_pay_disclosure_gap | 自由診療ページの本文(費用・期間・リスク表記の有無) | provider: 必須項目(費用/期間/リスク/代替手段)の記載有無チェック |
| patient_testimonial | 医院サイト本文(体験談・お客様の声セクション) | provider: 体験談セクションの検出 |
| before_after_gap | ビフォーアフター画像周辺のテキスト(個人差注記・治療内容/期間/費用の併記有無) | provider: 画像近傍テキストの必須項目チェック |
| review_incentive | 口コミ依頼文言・口コミページ運用方針のテキスト(取得できる範囲) | provider: 「特典」「高評価のみ」等のパターンマッチング |
| review_response_pii | 口コミ返信テキスト | provider: 氏名・電話番号・メールアドレス等のPIIパターン検出 |
| other_general_risk | 上記いずれのチェックにも該当しないが、providerが自由記述で報告した所見 | provider: 任意(P0 mockでは常に空、または1件のサンプル所見) |

**P0時点の重要な制約**: 現行の`runFreeDiagnosis`は医院サイトの実本文をまだ取得・保持していません(providerはすべてmockで、`clinicUrl`は検証のみ・実フェッチなし)。したがって、P0のmock providerは実際のテキスト解析ではなく、改善TOP3の`mockScoreProvider`と同様に**決定的な擬似データ生成**(入力URLやクリニック名から再現可能な固定パターンで所見の有無を生成)に留めます。実際にサイト本文を取得・解析するのは、Google連携やクロール基盤が入った後の本番プロバイダー実装で対応する前提です。この制約は改善TOP3の「mock criterionは達成率のみで実データではない」という既存の暫定実装と同種であり、`provisional`相当のフラグ(下記5節)で明示します。

## 4. severity / confidenceの設計(2026-09-05 ご指示によりエスカレーション連携条件を確定)

正本§13.2は「リスク区分」「院長・法務確認の要否」を出力項目として求めていますが、具体的な段階は定義していません。以下を提案します。

- **severity(3段階、`AdRiskSeverity`)**: `high`(重大: 明確に医療広告ガイドライン上のリスクが高い表現・欠落。早期の院長・法務確認を推奨)/ `medium`(注意: 表現の見直しを推奨)/ `low`(軽微: 念のため確認を推奨)。
  - 既存の改善TOP3エスカレーション(`EscalationSeverity`は`critical`|`high`の2段階)とは**別の型**として定義します。医療広告リスクは「情報が古い」等の技術的な重大障害とは性質が異なり、AIによるテキスト判定という性質上、常に幅を持った3段階表示が実態に合うと判断したためです。
  - `other_general_risk`は前述のとおり`high`を割り当てません(`medium`または`low`のみ)。
- **confidence(3段階、`AdRiskConfidence`)**: `high`(既知の禁止表現パターンに直接一致)/ `medium`(パターンの一部一致・文脈依存で判断がやや間接的)/ `low`(providerが自由記述で報告した所見、または`other_general_risk`)。
  - confidenceは**severityとは独立**に持たせます。「confidenceが低いから表示しない」という設計にはしません(6節の「AIによるリスクチェック」という前提そのものが、確度の低さを含めて提示する設計のため)。低confidenceの所見も必ず`adComplianceChecks`には表示します。

### 4.1 severity × confidence によるTOP3エスカレーション可否(2026-09-05確定)

ご指示により、severityとconfidenceの組み合わせでTOP3への強制エスカレーション可否を次のように区別します(`isEscalationEligible(finding): boolean`として実装)。

| severity | confidence | 扱い |
|---|---|---|
| `high` | `high` または `medium`(=confidence十分) | 改善TOP3へ強制エスカレーション対象(`legal_medical_ad_privacy`へ合流) |
| `high` | `low`(=confidence不十分) | **TOP3へは入れない**。重大リスクの可能性がある旨は`adComplianceChecks`側に表示するが、「要確認」に留め、法令違反やTOP3の重大リスクと断定しない |
| `medium` または `low` | 問わず | `adComplianceChecks`側にのみ表示(TOP3へは入れない) |

「confidence十分」を`high`/`medium`の2段階、「confidence不十分」を`low`のみとしたのは、mock provider段階では`low`が「パターンに直接一致しない・自由記述の所見」を意味するため(3節参照)、この段階でTOP3という最も目立つ場所へ断定的に押し出すのは正本§13が求める「違反断定でなくリスクチェック」という前提に反すると判断したためです。実プロバイダー接続後、この境界(`high`/`medium`のどちらを十分とするか)は実データで見直す前提とします。

## 5. 「違反断定」ではなく「リスクチェック」とする表示ルール(2026-09-05: 必須3文言を確定)

これはご指示のとおり型・データ構造のレベルで強制します。

- `AdRiskFinding`型に**「違反(violation)」を意味するフィールド・真偽値は一切持たせません**。フィールド名・コメント・ユーザー向け文言のいずれにも「違反」「抵触」という語を使わず、「リスク」「要確認」「念のため」という語のみを使用します。
- severityごとの表示文言はハードコードされた固定テンプレート関数(`describeSeverity(finding): string`)からのみ生成し、上位層で文言を自由合成させません。`severity`だけでなく4.1節のエスカレーション可否も加味し、次のように出し分けます。
  - `high` + confidence十分(TOP3エスカレーション対象) → 「AIによるリスクチェック: 重大な医療広告リスクの可能性があります。法令違反を断定するものではありません。早めに院長・専門家の確認をおすすめします」
  - `high` + confidence不十分(要確認止まり) → 「AIによるリスクチェック(要確認): 重大なリスクの可能性がありますが、確度が十分ではないため断定していません。法令違反を断定するものではありません。最終判断は医院または専門家が行ってください」
  - `medium` → 「AIによるリスクチェック: 表現の見直しをおすすめします。法令違反を断定するものではありません。最終判断は医院または専門家が行ってください」
  - `low` → 「AIによるリスクチェック: 念のためご確認をおすすめします。最終判断は医院または専門家が行ってください」
- ご指示により、次の3つの定型文言を**すべての表示文言に含める**ことを必須とします(固定テンプレート関数の出力に対するunit testで機械的に担保します)。
  1. 「AIによるリスクチェック」
  2. 「法令違反を断定するものではありません」
  3. 「最終判断は医院または専門家が行ってください」
- 結果全体に対する固定の免責文言を`AdComplianceCheckResult.disclaimer`として必ず1つ持たせます(上記3文言をすべて含む形で): 「これはAIによるリスクチェックであり、法令違反を断定するものではありません。最終判断は医院または専門家が行ってください。」(`runFreeDiagnosis`の既存`dataDisclaimer`と役割は同じですが、医療広告チェック特有の文言のため別フィールドにします)。
- unit testでこの制約を機械的に担保します(10節参照: 禁止語彙の混入・必須3文言の欠落をテストで検出)。

## 6. evidenceの保持方法

改善TOP3の`structuredEvidence: CriterionEvidence[]`と同じ考え方(「なぜこの判定か」を後から追跡できる構造化evidence)を踏襲しつつ、医療広告チェック特有の配慮を加えます。

```
interface AdRiskEvidence {
  category: AdRiskCategoryKey;
  quotedText: string;       // 該当箇所の引用(最大120文字程度に切り詰め)
  sourceLocation: string;   // 例: "トップページ本文", "自由診療ページ(ホワイトニング)", "口コミ返信(2026-08-20)"
  detectionReason: string;  // なぜこの箇所を検出したか(パターン名等、内部向け)
}
```

- **`review_response_pii`カテゴリのみ特別扱い**: `quotedText`に実際の個人情報(氏名・電話番号等)をそのまま保持しません。検出した個人情報は`"[個人情報を検出: 電話番号らしき文字列]"`のようにマスキングした文字列に置き換えます。これは`PRODUCT_SPEC.md`/`機能要件定義書§21`の「患者個人情報を原則取得しない」という絶対ルールと整合させるためです(口コミ投稿者自身の個人情報が返信文に紛れ込むケースを想定)。
- evidenceは`AdRiskFinding`単位で1件以上(通常1件)保持し、改善TOP3の`sourceCriteria`のような「根拠の追跡可能性」を確保します。

## 7. 無料診断結果への組み込み方

`RunFreeDiagnosisResult`に新しいフィールドを追加します(既存フィールドは変更しません)。

```
interface RunFreeDiagnosisResult {
  // ...既存フィールド...
  adComplianceChecks: AdComplianceCheckResult;
}

interface AdComplianceCheckResult {
  findings: AdRiskFinding[];       // 検出された所見一覧(0件もあり得る)
  disclaimer: string;              // 5節の固定免責文言
  checkedAt: string;               // 測定日時(既存のmeasuredAtパターンに合わせる)
}
```

無料診断(60秒診断)は本文取得の仕組みがまだないため、P0では`findings`は**mock providerが返す少数の決定的な所見**(0〜2件程度)に留まります。既存の`dataDisclaimer`同様、「モックデータであり実際のサイト本文は解析していません」という趣旨を`disclaimer`または既存の`dataDisclaimer`に追記する必要があります(要確認: 既存`dataDisclaimer`に追記するか、`AdComplianceCheckResult.disclaimer`を分けるか、次のご指示を待ちます)。

## 8. 改善TOP3との連携方法(2026-09-05 ご指示により確定: 案A、エスカレーション条件を限定)

**共通の前提**: `adComplianceChecks`は改善TOP3とは別に、診断結果内の独立したセクションとして常に表示します(正本§13.2が「検出箇所/リスク区分/理由/修正候補/院長・法務確認の要否」という改善タスクより詳細な出力を求めているため、TOP3のカード形式に収まりきりません)。severity/confidenceにかかわらず、**すべての所見はこの独立セクションに表示されます**。

その上で、TOP3のエスカレーション(`legal_medical_ad_privacy`)への連携は**案A(連携する)を採用**しつつ、4.1節の条件で限定します。

- **`isEscalationEligible(finding)` = severity=`high` かつ confidence十分(`high`または`medium`)の所見のみ**、`kind: "risk_escalation"`の`ImprovementCandidate`を生成し、既存の`legal_medical_ad_privacy`エスカレーションカテゴリに合流させます。
- severity=`high`だがconfidence=`low`の所見、およびseverity=`medium`/`low`の所見は、**TOP3候補を一切生成しません**。「要確認」として`adComplianceChecks`側にのみ表示し、TOP3という最も目立つ場所で断定的な重大リスク扱いにはしません。
- `generateImprovementCandidates()`の入力に`externalCandidates?: DraftImprovementCandidate[]`のような任意パラメータを追加し、`runFreeDiagnosis.ts`側で`isEscalationEligible()`を満たす所見からのみ候補を生成して差し込めるようにします(`buildTopImprovements()`のシグネチャ変更を伴います)。
- rootCauseKey(2026-09-05の構造再整理で導入した重複整理の鍵)は、医療広告AIチェック由来の候補には`ad-compliance:${category}:${findingId}`のような専用形式を振り、45項目カタログの`rootCauseKey`体系と衝突しない・重複整理の対象にもならないようにします(改善TOP3側の質問結果由来候補=`adhoc:*`と同じ考え方です)。
- **既存のエスカレーションカテゴリ優先順位は変更しません**。`ESCALATION_CATEGORY_ORDER`(`legal_medical_ad_privacy` → `booking_failure` → `clinic_info_mismatch` → `ai_crawler_failure` → 通常20点ランキング)はそのまま維持し、医療広告AIチェック由来の候補も`legal_medical_ad_privacy`カテゴリの一員として、このカテゴリ内のseverity→confidence→20点スコアのタイブレークに従います(`compareEscalation()`のロジックは変更不要です)。
- これにより、正本§11.2「法令・個人情報リスクは合計点に関係なく最優先」という原則を、confidenceが十分な所見に限定してTOP3側でも一貫して守ります。

既存の3項目(`reviews-response-contains-pii`, `reviews-exaggerated-claims`, `reviews-incentivized-reviews`)との重複については、特にご指示がないため**(i) 現状維持**(既存3項目は`REVIEWS.policy_risk`のmock達成率ベースのまま残し、新しい医療広告AIチェックは別軸の独立機能として併存させる)で進めます。将来的な一本化((ii): 医療広告AIチェックの検出結果を既存3項目の発火条件として使う)は、45項目カタログの`evidenceRequirements`を変更する追加スコープになるため、着手する場合は改めてご指示ください。

## 9. 変更予定ファイル

案A(連携する)確定を反映した最終版です。

- 新規: `src/domain/ad-compliance/types.ts`(`AdRiskCategoryKey`, `AdRiskSeverity`, `AdRiskConfidence`, `AdRiskEvidence`, `AdRiskFinding`, `AdComplianceCheckResult`)
- 新規: `src/domain/ad-compliance/riskCatalog.ts`(11カテゴリの定義・表示文言テンプレート。`candidateCatalog.ts`と同じ「唯一の情報源」パターン)
- 新規: `src/domain/ad-compliance/buildAdComplianceResult.ts`(providerの生所見を受け取り、evidenceのPIIマスキング・並び替え・disclaimer付与を行う純粋関数群)
- 新規: `src/server/providers/ad-compliance/types.ts`(`AdComplianceProvider`インターフェース)
- 新規: `src/server/providers/ad-compliance/mockAdComplianceProvider.ts`(P0 mock実装)
- 変更: `src/server/services/runFreeDiagnosis.ts`(`AdComplianceProvider`を依存に追加、`adComplianceChecks`をレスポンスに追加、severity=highの所見を`buildTopImprovements()`へ外部候補として連携)
- 変更: `src/domain/improvement-task/priorityScoring.ts`(`generateImprovementCandidates`/`buildTopImprovements`に外部候補の差し込み口を追加。既存の`rankImprovementCandidates`/`deduplicateByRootCause`のロジック自体は変更しない想定)
- 変更: `src/domain/improvement-task/types.ts`(外部候補生成のヘルパー型が必要であれば追加。既存フィールドは変更しない想定)
- 新規テスト: `tests/unit/adComplianceCatalog.test.ts`, `tests/unit/adComplianceCheck.test.ts`
- 変更テスト: `tests/unit/runFreeDiagnosis.test.ts`(配線の結合テストを追加)、`tests/unit/priorityScoring.test.ts`(外部候補の連携テストを追加)

引き続き、UI・Google連携・DB・認証・決済・アンバサダーには触れません。

## 10. unit test方針

- **カタログ完全性**: 正本§13.1の9項目(ご指示の11分類)がすべて`riskCatalog.ts`に存在し、key重複がないこと(`candidateCatalog.test.ts`と同じ形式)。
- **表示ルールの機械的担保(5節)**: `describeSeverity()`や固定テンプレート文言に「違反」「抵触」等の禁止語彙が含まれていないことを、全severity・全confidence・全カテゴリの組み合わせについて総当たりでテストする。加えて、5節で必須とした3文言(「AIによるリスクチェック」「法令違反を断定するものではありません」「最終判断は医院または専門家が行ってください」)がすべての表示文言・`disclaimer`に含まれていることを検証する。これにより、将来の文言変更で誤って断定的な表現が混入する、または必須文言が欠落することをコードレベルで防ぐ。
- **`other_general_risk`のseverity制約**: このカテゴリの所見が`severity: "high"`にならないことを検証する。
- **evidenceのPIIマスキング(6節)**: `review_response_pii`カテゴリの所見について、mock providerが検出した生のPII文字列(例: ダミーの電話番号)が、`buildAdComplianceResult()`後の`quotedText`にそのまま残っていないことを検証する。
- **`runFreeDiagnosis`結合テスト**: `adComplianceChecks`が常に結果に含まれ、`disclaimer`が空でないこと。mock providerが所見なしを返すケース(`findings: []`)でも結果全体が壊れないこと。
- **エスカレーション可否の境界テスト(4.1節・8節、最重要)**: `isEscalationEligible()`について次の4パターンを網羅する。
  1. severity=`high` + confidence=`high` → エスカレーション対象(`true`)
  2. severity=`high` + confidence=`medium` → エスカレーション対象(`true`)
  3. severity=`high` + confidence=`low` → エスカレーション対象**外**(`false`)。実際に`topImprovements`へ候補が生成されないことも確認する
  4. severity=`medium`または`low`(confidence問わず) → エスカレーション対象外(`false`)
  - エスカレーション対象となった所見が`topImprovements`内で`kind: "risk_escalation"`かつ`category: "legal_medical_ad_privacy"`の候補として現れ、かつ`ESCALATION_CATEGORY_ORDER`(legal_medical_ad_privacy→booking_failure→clinic_info_mismatch→ai_crawler_failure)の優先順位が既存の45項目カタログ由来のエスカレーションと混在しても崩れないことを検証する。
  - 外部候補のrootCauseKey(`ad-compliance:*`)が45項目カタログ側の重複整理(`deduplicateByRootCause`)と衝突しない・巻き込まれないことを検証する。

---

以上が設計提案です(2026-09-05: 8節は案A[エスカレーション条件は4.1節のとおり限定]で確定、既存3項目は(i)現状維持で進めます)。この内容で実装を開始してよいか、ご確認をお願いします。
