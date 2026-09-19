# 「なぜ負けている？」root cause TOP3 設計案(2026-09-06、確定版)

対象: `PatientQuestionResult`(AIO患者質問の勝敗)を根拠にした敗因(root cause)候補TOP3のドメイン/サービス層ロジック。
本ドキュメントは、2026-09-06の初版設計案に対するユーザーの4点確定回答を反映した**実装確定版**です。
このバージョンの方針に沿って実装まで進めます。正式ダッシュボードUI・improvement TOP3ロジック変更は引き続きスコープ外です。

## 変更履歴

初版からの主な変更点(ユーザー確定方針①〜④):

- ① attribution granularityを「domain-wideの弱いcriterionをそのまま質問へ割当」から**「質問単位のevidence-first attribution」**へ変更。AIO criterionスコアは補助的corroborationの位置づけに変更(今回のロジックには実装しない。5節)。
- ② 保存方針を「完全on-demand導出」から**「per-question attributionを`questionResultsJson`内(`PatientQuestionResult`の追加フィールド)へ保存し、全体TOP3はそこから集約する」**方式へ変更。`analysisVersion`で判定ロジックのバージョンを追跡する。
- ③ 既存の`aio-losing-patient-questions`候補(improvement TOP3側)は**今回一切変更しない**。責務分離(explanatory diagnosis / action prioritization)を明文化。
- ④ 固定`ratio < 0.6`しきい値は不採用。question-level evidenceを主判定にし、AIO criterionスコアによる直接判定は行わない。

## 9. 変更予定ファイル

新規:
- `src/domain/competitor/aioLossAttribution.ts` — `attributeQuestionLoss()`(質問単位判定)・`aggregateAioLossRootCauses()`(TOP3集約)・`AIO_LOSS_ATTRIBUTION_LOGIC_VERSION`定数
- `tests/unit/aioLossAttribution.test.ts` — 単体テスト(10節)

変更:
- `src/domain/competitor/types.ts` — `PatientQuestionResult`拡張、`AioLossRootCauseKey`/`AioLossAttributionStatus`/`AioLossConfidence`/`AioLossRootCauseSummary`追加
- `src/server/services/runFreeDiagnosis.ts` — `buildQuestionResults()`内でlose質問に`attributeQuestionLoss()`を適用、結果に`aioLossRootCauses: aggregateAioLossRootCauses(questionResults)`を追加
- `tests/unit/runFreeDiagnosis.test.ts` — 配線確認テストを追加
- `tests/unit/diagnosisPersistenceShapes.test.ts` — 拡張後の`PatientQuestionResult`のJSON往復テストを追加(既存のPatientQuestionResultラウンドトリップテストへ新フィールドを追記)
- `tests/integration/diagnosisRepository.test.ts` — `questionResultsJson`経由でattribution結果が保存後も保持されることの確認を追加

変更しないもの:
- `prisma/schema.prisma` / migration
- `src/domain/improvement-task/priorityScoring.ts`(既存の`aio-losing-patient-questions`候補、7節)
- `src/server/db/diagnosisRepository.ts`(8節の通り、読み出し側の集約配線は今回スコープ外)
- 正式ダッシュボードUI一式

## 10. unit test方針

`tests/unit/aioLossAttribution.test.ts`(純粋関数、DB不要):

1. **citation_acquisition判定**: 競合が言及されているlose質問 → `rootCauseKey: "AIO:citation_acquisition"`, `attributionStatus: "attributed"`
2. **ai_search_presence判定**: 競合の言及も無いlose質問 → `rootCauseKey: "AIO:ai_search_presence"`, `attributionStatus: "attributed"`
3. **tie(close)除外**: `status: "close"`の質問には`attributionStatus: "not_applicable"`, `rootCauseKey: null`が設定される
4. **insufficient_data除外**: `status: "insufficient_data"`の質問も同様に`not_applicable`/`null`
5. **confidence格下げ**: mock観測のみのlose質問(citation_acquisition該当)は`confidence: "medium"`(mock混入によりhighへ格上げしない、ユーザー指示④相当)
6. **dedup**: 同一rootCauseKeyに複数のlose質問が該当する場合、`aggregateAioLossRootCauses()`が1件の`AioLossRootCauseSummary`に統合し、`linkedQuestions`に全質問が含まれる
7. **ranking**: confidence→affectedQuestionCount→competitorGapStrength→provisionalペナルティの優先順で並ぶことを、複数パターンのfixtureで確認
8. **無理に3件へ埋めない**: attributedなrootCauseKeyが1種類しかない場合、`aggregateAioLossRootCauses()`は1件だけ返す
9. **lose質問0件**: 空配列を返す(捏造しない)
10. **JSON往復**: 拡張後の`PatientQuestionResult`(新フィールド全部)がJSON.stringify/parseを経ても欠落しない(`diagnosisPersistenceShapes.test.ts`)

`tests/unit/runFreeDiagnosis.test.ts`に追加:
- `runFreeDiagnosis()`の結果に`aioLossRootCauses`が含まれ、既存の`topImprovements`(`aio-losing-patient-questions`候補含む)に変化がないこと(責務分離の配線確認)

`tests/integration/diagnosisRepository.test.ts`に追加:
- lose質問を含む診断を保存・取得し、`questionResultsJson`経由で`rootCauseKey`/`confidence`/`attributionStatus`/`analysisVersion`等が保存後も保持されることを確認

既存178件のテストのうち、`PatientQuestionResult`リテラルを直接構成しているfixture(`priorityScoring.test.ts`等)は、新規必須フィールド追加に伴い機械的な追記が必要です(既存の検証内容・テストの意図は変更しません。2026-09-06のunavailableReason追加時と同じ対応です)。

## 1. 出力型

`PatientQuestionResult`(`src/domain/competitor/types.ts`)を直接拡張します(既存の`questionResultsJson`にそのまま乗るため)。新しい型・ロジックは新規ファイル`src/domain/competitor/aioLossAttribution.ts`に置きます(責務分離: 型は`competitor/types.ts`、ロジックは別ファイル、という既存の`scoring.ts`/`priorityScoring.ts`と同じ分離パターン)。

```ts
// src/domain/competitor/types.ts (拡張)

/** 45項目カタログのrootCauseKey命名規約(`${DomainKey}:${criterionKey}`)を再利用する。
 *  新しい原因カテゴリを捏造せず、既存のAIO 5criterionの語彙のみを使う。 */
export type AioLossRootCauseKey =
  | "AIO:ai_search_presence"
  | "AIO:citation_acquisition"
  | "AIO:recommendation_rank"
  | "AIO:information_accuracy"
  | "AIO:question_domain_coverage"
  | "aio-loss:unattributed";

export type AioLossAttributionStatus = "attributed" | "insufficient_evidence" | "not_applicable";
export type AioLossConfidence = "high" | "medium" | "low";

export interface PatientQuestionResult {
  question: string;
  status: QuestionOutcomeStatus;
  evidence: string[];
  unavailableReason: UnavailableReason | null;

  // 2026-09-06: 「なぜ負けている?」root cause属性。status==="lose"の質問のみ実値を持つ。
  // それ以外(win/close/insufficient_data)は not_applicable / null / [] / false 固定。
  competitorDifference: string[]; // 競合が言及されているが自院は言及されていない、という質問単位の直接signal
  rootCauseKey: AioLossRootCauseKey | null;
  rootCauseLabel: string | null; // 断定を避けた日本語ラベル(院長向け最終翻訳はUI層の責務)
  confidence: AioLossConfidence | null;
  sourceType: "mock" | "live" | null; // その質問の観測群にmockが1件でも混ざれば"mock"
  provisional: boolean; // sourceType==="mock"から機械的に導出(既存パターンと同一原則)
  attributionStatus: AioLossAttributionStatus;
  analysisVersion: string | null; // ロジック改訂を追跡(将来ロジック変更時も過去診断の判定根拠を再現できる)
}

/** 全体TOP3の集約結果。questionResultsの永続化データから都度再集約できる(2節参照)ため、
 *  これ自体は永続化しない(8節)。 */
export interface AioLossRootCauseSummary {
  rootCauseKey: AioLossRootCauseKey; // "aio-loss:unattributed"はここには出てこない(4節)
  rootCauseLabel: string;
  linkedQuestions: string[]; // トレーサビリティ(この原因の根拠になった質問一覧)
  affectedQuestionCount: number;
  confidence: AioLossConfidence; // 集約ルールは3節参照(弱い方に合わせる)
  competitorGapStrength: number; // linkedQuestions全体でユニークな競合名の件数
  isProvisional: boolean;
  analysisVersion: string;
}
```

`RunFreeDiagnosisResult`(`runFreeDiagnosis.ts`)に`aioLossRootCauses: AioLossRootCauseSummary[]`(TOP3・空配列可)を追加します。既存の`topImprovements`とは別の独立フィールドです。

## 2. root cause判定ルール(質問単位・evidence-first)

対象: `status === "lose"` の質問のみ。`close`(tie相当)・`insufficient_data`は対象外。unavailable(criterionのunavailable)も原因断定に使わない(5節)。

各lose質問について、その質問に紐づく`AiObservationResult[]`(`aiObservations.filter(o => o.question === q.question)`)から、**優先順位順に**直接確認できるsignalを判定します(AIO criterionスコアによる補助corroborationはP0では実装しません。理由は5節)。

1. **`competitorMentions`が1件以上ある**(=この質問のAI回答で競合医院が明示的に言及されているが、自院は言及されていない): `rootCauseKey: "AIO:citation_acquisition"` / `confidence: "high"`(mock混入時は"medium"に減点。6節)。これは「競合との差」が質問単位で直接確認できる最も具体的なsignalです。
2. **`competitorMentions`が0件**(競合も自院も言及なし。それでも自院が一切言及されていないこと自体はlose判定の定義から質問単位で直接確認済みの事実): `rootCauseKey: "AIO:ai_search_presence"` / `confidence: "medium"`(mock混入時は変わらず"medium"。7節)。
3. 観測が1件もない場合(lose判定の定義上、通常は発生しない防御的分岐): `rootCauseKey: "aio-loss:unattributed"` / `attributionStatus: "insufficient_evidence"`。

**重要な事実確認(実装前に必ずご確認ください)**: ユーザー提示の5例のうち、`recommendation_rank`(自院は出るが競合よりrankが低い)は、lose判定の定義(全観測でmentioned=false)と両立しません。lose質問では自院が一切言及されていないため、rankの比較対象そのものが存在しません。同様に`information_accuracy`(情報不一致のevidence)・`question_domain_coverage`(質問領域不足のevidence)も、現在の`AiObservationResult`(`mentioned`/`recommendationRank`/`competitorMentions`/`citations`/`region`/`evidence`(自由記述文字列))には、これらを機械的に検出できる構造化signalが存在しません。evidence文字列に対するキーワード一致等でこれらを検出することも検討しましたが、根拠の薄い推測になり「原因を捏造しない」方針に反するため採用しません。

したがって、**P0では実際に到達するrootCauseKeyは`AIO:citation_acquisition`と`AIO:ai_search_presence`の2種類のみ**です。他の3種類(recommendation_rank/information_accuracy/question_domain_coverage)は型として定義しておき(将来のprovider実装で質問単位の構造化signalが追加された時点で使う)、P0のロジックからは生成されません。`aio-loss:unattributed`/`insufficient_evidence`も、上記の通りlose判定の定義上ほぼ到達しない防御的分岐です(実質的にすべてのlose質問がcitation_acquisitionまたはai_search_presenceに帰属します)。この認識に基づいてそのまま実装します。異なる想定であれば実装後にご指摘ください(型・関数の差し替えは容易な設計にしています)。

## 3. importance ranking

`improvement TOP3`の4軸スコアリングは再利用しません(4節: 責務分離)。単純で説明可能な決定論的ルール(タプル比較、恣意的な重み付けの合成スコアは作らない)を採用します。

対象は`attributionStatus === "attributed"`の質問のみを`rootCauseKey`でグループ化した`AioLossRootCauseSummary`です(`insufficient_evidence`/`not_applicable`はランキング対象外)。

比較優先順位(上から順に、同値なら次の基準へ):

1. **evidence confidence**(集約後の`confidence`。"high" > "medium" > "low")
2. **影響したlose質問数**(`affectedQuestionCount`降順)
3. **competitor gapの強さ**(`competitorGapStrength`降順。=関連質問全体でAIに言及された競合のユニーク数)
4. **provisional/estimatedペナルティ**(非provisionalを優先。mock混入した根拠より、実測に基づく根拠を上位にする)
5. (完全同値時の最終tie-break)`rootCauseKey`の文字列比較(決定論性の担保のみが目的で、実質的な優先度の意味は持たせない)

上位最大3件を返します。**根拠が十分な原因が1件しかない場合は1件のみ返し、無理に3件へ埋めません。**

集約時の`confidence`は、同一`rootCauseKey`に複数の質問が紐づく場合、**最も弱い(low<medium<high の意味で最小)confidenceに合わせます**(1件でも弱い根拠が混ざれば全体を「強い」と言い切らない、既存の`computeIsSample()`等の「1件でも混ざれば全体に反映する」原則と同じ考え方)。

## 4. dedupルール

質問単位のattribution結果(`PatientQuestionResult[]`)を`rootCauseKey`でグループ化するだけで、同一`rootCauseKey`は自然に1件の`AioLossRootCauseSummary`に統合されます(事後の重複整理ステップは不要。既存の`ImprovementCandidate.deduplicateByRootCause()`とは無関係・別実装)。`linkedQuestions`は質問文でユニーク化します。

## 5. evidence不足時の扱い(unattributedになる条件)

- 観測が1件もない質問は、そもそも`buildQuestionResults()`の時点で`status: "insufficient_data"`になり、`"lose"`にはならないため、本ロジックの対象に入りません(1節・0節)。
- **P0の実データ上、`status==="lose"`の質問は常に1件以上の観測を持つため、`attributionStatus: "insufficient_evidence"`は実質的に到達しない防御的分岐です**(2節の「重要な事実確認」)。zero-observation-for-a-lose-question という理論的にのみ存在するケースに備えて実装しますが、P0のmock providerではこの分岐をunit testで直接構成しない限り再現できません。
- `unavailable`(criterionのstatus)は原因の直接判定に一切使いません(4節: AIO criterionスコアによる補助corroboration自体をP0では実装しないため、unavailableかどうかを気にする必要がそもそもありません)。
- AIO criterionスコアによる補助的corroborationはP0では実装しません。理由: ①の判定ルールだけで、現状到達可能な2種類のrootCauseKey(citation_acquisition/ai_search_presence)を十分説明可能な質問単位のevidenceが揃っているため、追加の判定材料は不要と判断しました。将来、より曖昧な質問単位signal(例: 観測はあるが競合言及も自院言及も無い、かつ複数プロバイダーで結果が割れている等)が増えた場合の拡張ポイントとして設計上の余地(`attributeQuestionLoss()`関数のシグネチャに`domainScore`等を追加する形)を残しますが、今回のコードには組み込みません。

## 6. mock/estimated/provisionalの扱い(confidence計算を含む)

- `provisional`/`sourceType`は既存パターンと同じく、`AiObservationResult.dataSource`のみから機械的に導出します(providerが自己申告することはない)。その質問の観測群に`dataSource === "mock"`が1件でもあれば`sourceType: "mock"`, `provisional: true`。
- **confidenceは「evidenceの量」だけで決めず、mock混入時は常に減点します**:
  - ベースconfidence: signalの具体性で決まる(2節)。`citation_acquisition`(競合が明示的に言及されている、具体的な差分)→ベース"high"。`ai_search_presence`(自院が単に出ていないという一般的事実)→ベース"medium"。
  - `provisional === true`の場合、ベースが"high"でも**"medium"に格下げ**します(mock/estimated由来のevidenceだけでは実測原因として"high"を名乗らせない、というユーザー指示④の直接反映)。`provisional === false`の場合はベースをそのまま使います。
  - P0では全provider がmockのみのため、**実際には常にconfidence: "medium"になります**(citation_acquisitionのケースであっても、mock混入により"high"から格下げされるため)。これは意図通りで、将来ChatGPT/Gemini実接続後に初めて"high"が出ます。

## 7. improvement TOP3との責務分離

- 「なぜ負けている?」= explanatory diagnosis(説明・原因の可視化)、improvement TOP3 = action prioritization(何をすべきかの優先順位付け)、と明確に役割分担します。
- 既存の`generateAioQuestionCandidates()`内の`aio-losing-patient-questions`候補(`priorityScoring.ts`)は**一切変更しません**。新しいroot cause分析結果から改善candidateを追加・削除・置換することも行いません。
- 両者は完全に独立した2つの出力(`topImprovements` / `aioLossRootCauses`)として`RunFreeDiagnosisResult`に共存します。重複整理や相互の紐付けは、正式UI/改善連携フェーズで別途判断します。

## 8. 保存要否

**Prisma schemaの変更・新migrationは不要です。**

- 質問単位のattribution結果(`competitorDifference`/`rootCauseKey`/`rootCauseLabel`/`confidence`/`sourceType`/`provisional`/`attributionStatus`/`analysisVersion`)は`PatientQuestionResult`の追加フィールドとして、**既存の`questionResultsJson`(String列)にそのまま含まれます**(`JSON.stringify(result.questionResults)`は変更不要。型が拡張されるだけで、シリアライズ経路は既存のまま)。
- これにより「診断時点で何を根拠に原因判定したか」(`analysisVersion`込み)が診断ごとに固定され、将来ロジックを変更しても過去診断の説明性が保たれます。
- **全体TOP3(`AioLossRootCauseSummary[]`)自体は保存しません**。保存済みの`questionResults`(`analysisVersion`付きの質問単位attribution)から、`aggregateAioLossRootCauses()`で都度再集約します。`runFreeDiagnosis()`は新規診断時にこの集約を1回実行し、結果に含めます。
- 補足(スコープ外・GAPとして明記): `getDiagnosisById()`(`diagnosisRepository.ts`)の読み出しパスでは、今回は`aggregateAioLossRootCauses()`の呼び出しを追加しません(今回の実装範囲に含まれていないため)。保存済み診断を読み直す際にTOP3集約を再現するには、将来のUI統合フェーズで読み出し側にも同じ集約関数を配線する必要があります。
