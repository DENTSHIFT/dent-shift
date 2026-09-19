# 実AI計測provider P0設計案(2026-09-07)

本ドキュメントは「無料診断で使っているmock AI providerを、実際のAI計測データに置き換える」ためのP0設計案である。**2026-09-06にユーザーより設計方針(大枠)が承認され、7点の修正指示を受けた。2026-09-07にさらに11点の追加確定事項の指示を受け、本版はそれらすべてを反映した版である。**

**現時点のステータス: 設計書の更新・報告のみ。コード実装は未着手であり、着手しない。** `OpenAiProvider`/`GeminiProvider`実装、feature flag実装、APIキー接続、env追加、`runFreeDiagnosis.ts`への実provider接続、scoring変更、root cause変更、Prisma変更、migration作成は、ユーザーが本設計書の内容を確認・最終承認するまで一切行わない。

## 改訂履歴(1回目: 2026-09-06 承認時の修正指示)

1. OpenAIのモデル名(`gpt-6-astra`等)をコードへ固定しない。`OPENAI_AI_MEASUREMENT_MODEL`のような環境変数で指定可能にする。
2. Google AI Overviewsについて、「公式APIが存在しない」という表現ではなく、「AI Overviewsそのものを公式に直接計測できる一般利用向けAPIはP0では採用しない」という表現にする。
3. provider実装自体は既存6質問すべてに対応させる。P0の実運用ではfeature flag/configで2〜3問だけ実測する構造にするが、コード上で質問数を固定しない。
4. competitor抽出は回答本文に明示的に登場した実在医院候補のみとし、mock競合とは絶対に混在させない。
5. API失敗時は0点化・黙示的mock fallbackを禁止し、必ず`unavailableReason`を残す。
6. rankingは検索順位ではなく「AI回答本文内での言及順による推定順位」とし、`provisional = true`を必須にする。
7. scoring/root causeロジックは変更しない。

## 改訂履歴(2回目: 2026-09-07 追加確定事項)

1. 「ChatGPT実測」という呼称を禁止し、「OpenAI Web Search API実測(OpenAI検索API計測)」「Gemini API + Google Search Grounding実測」に統一する(A章)。
2. OpenAI側はプロンプト文への地域埋め込みだけでなく、structured `user_location`(city/country/region/timezone)を優先して使う(10章)。
3. APIを呼んだだけで「検索実測済み」と判定せず、search tool callが実際に発生したかを判別・保存する(C章)。
4. 実測質問とmock質問を同一AIOスコアへ混ぜない確定ルールを設ける。実測coverageを明示し、AIO集計はpartial扱いとする(D章)。
5. 「回答本文内の言及順」由来のrankは、観測全体が実API由来でもrank自体は`provisional`な推定値として扱う。field-level provenanceを導入する(E章)。
6. AI回答に医院名らしき文字列が出ただけで「実在競合医院」と確定しない。確認レベルを分けてprovisional候補として扱う(F章)。
7. citation URLの取得可否と「自院公式サイトがcitationされたか」の判定を分離し、URL正規化ルールを設計する(G章)。
8. APIコスト概算式を、token/tool呼び出し/検索クエリ数を考慮した式に修正し、実装後はprovider response/usageから実使用量を計測できる構造にする(15章改訂)。
9. Gemini API + Google Search Groundingの結果を「Google AI Overviews実測」として扱わない。両者は別surfaceとして明確に分離する(8.2節改訂)。
10. model/version等の保存方針を実装前に確定する。既存`AiObservation`列で不足する場合は、承認前にmigrationを作らず、schema変更案のみ提示する(11章改訂)。
11. Gemini Google Search Grounding responseの`search_suggestions`等の表示義務について、Googleの利用規約確認をlive provider有効化前の必須ブロッキング事項とする(H章)。

以下、上記すべてを反映した設計本文。

## 0. 前提・スコープ

### 0.1 目的
現在mockで生成している以下の項目を、実際のAI計測データに置き換え可能な構造にする。

- 自院がAIの回答内で言及されるか
- 推薦順位(に相当する signal)
- citation / link
- 競合医院の言及
- 患者質問ごとの勝ち負け
- なぜ負けているか(root cause)

### 0.2 P0対象provider
- OpenAI/ChatGPT系(公式API)
- Gemini系(公式API)
- Google AI Overviewsは調査の上、今回は独立providerとして採用しない(理由は8章)

### 0.3 今回のスコープ外(ユーザー指定、再掲)
Google GA4/Search Console実接続、GBP、Google Ads、Stripe、TimeRex、アンバサダー、本契約後ダッシュボード、外部サイト自動変更。**これらには一切手を入れない。**

### 0.4 設計方針
- 既存構造(`AiProvider`インターフェース、`RunFreeDiagnosisDeps`によるDI、Prismaの`AiObservation`スキーマ、`DataSource`/`UnavailableReason`型)を最大限再利用する。
- `runFreeDiagnosis.ts`のコアロジック(スコアリング・root cause attribution)には手を入れない。差し替えは「providerの実装を追加し、注入するインスタンスを変える」だけで完結させる。
- mockと実測を暗黙的に混ぜない。実測できない場合は「0点」でも「mockへの黙示的フォールバック」でもなく、`unavailableReason`を明示する。

---

## 1. 現在のmock AI provider構造(現状整理)

- `src/server/providers/ai/types.ts`: `AiProvider`インターフェース(`observe(input: AiObservationInput): Promise<AiObservationResult>`相当)、`AiObservationResult`は`mention`/`rank`/`citations`/`competitors`/`evidence`/`region`/`model`等を持つ。
- `src/server/providers/ai/mockAiProvider.ts`: `MockAiProvider`が`seededRandom`でclinicIdから決定的な疑似結果を生成する。
- `src/server/services/runFreeDiagnosis.ts`:
  - `PATIENT_QUESTIONS`に6つの固定質問(日本語)が定義されている。
  - `RunFreeDiagnosisDeps`が`aiProviders`(chatgpt/gemini)や`competitorProvider`等をインターフェース経由で注入している(=すでに差し替え可能な設計)。
  - `buildQuestionResults()`が各providerの`AiObservationResult`から勝ち/拮抗/負け/データ不足を判定し、evidence文字列を`` `[${provider}] ${evidence}` `` の形式で構築している。
  - `computeIsSample()`が診断全体のsample判定を行う。
- `src/domain/competitor/aioLossAttribution.ts`: `LossAttributionObservationInput { mentioned, competitorMentions, dataSource }`という最小限の型で動作しており、`AiObservationResult`全体には依存していない。
- `prisma/schema.prisma`の`AiObservation`モデルは`citationsJson`/`region`/`sourceType`/`provisional`/`model`/`measurementAt`/`capturedAt`をすでに持ち、実測データを受け入れる準備ができている。
- `src/domain/diagnosis/types.ts`の`DataSource`型はすでに`"ai_provider"`を含んでおり、`UnavailableReason`(7種)もそのまま流用可能。

**結論: スキーマ・DI構造ともに「実providerを追加するだけ」で受け入れられる設計にすでになっている。**

---

## 2. 実providerとの差し替え境界

- 差し替え境界は`AiProvider`インターフェースそのもの。`OpenAiProvider implements AiProvider`・`GeminiProvider implements AiProvider`を新規作成し、`RunFreeDiagnosisDeps`に注入するインスタンスをmockから実providerに変えるだけで良い。
- `runFreeDiagnosis.ts`本体(スコアリング・root cause・isSample判定ロジック)は**変更不要**。
- provider選択は環境変数/feature flagで制御する(例: `AI_PROVIDER_MODE=mock|real|mixed`)。デフォルトは`mock`のまま維持し、実装後も既存の無料診断動作に影響を与えない。
- 段階導入のため「providerごと」「質問ごと」に real/mock を切り替えられる粒度を持たせる(16章参照)。

---

## 3. OpenAI側で実際に取得可能なデータ

- OpenAI Responses APIの`web_search`ツールを使うと、モデルが自動的にWeb検索を行った上で回答を生成する。
- **モデル名はコードに固定しない。** 呼び出すモデルIDは環境変数`OPENAI_AI_MEASUREMENT_MODEL`で指定し、実装時点でOpenAIが提供しているweb_search対応モデルの中から運用側が選択・変更できるようにする。コード側はモデルIDを文字列としてそのまま渡すのみで、特定モデル名をハードコードしない。
- レスポンスには以下が含まれる。
  - 本文中の`url_citation`アノテーション(URL・タイトル・引用箇所の文字位置)
  - `sources`フィールド(モデルが参照した全URLの一覧。表示引用より広い場合がある)
  - `web_search_call`アイテム(実行された検索アクションのメタ情報)
- `user_location`パラメータ(country/city/region/timezone)で地理的な条件を指定可能。
- **取得できないもの**: 「検索結果のランキング順位」に相当する構造化データそのものは提供されない。あくまで自然文の回答+引用であり、Google検索のSERP順位のような明示的なランクは無い。

---

## 4. Gemini側で実際に取得可能なデータ

- Gemini APIの`google_search` grounding tool(tools配列に`{"type": "google_search"}`を追加)を使うと、クエリ生成→検索実行→統合→引用付き回答、が自動で行われる。
- レスポンスには以下が含まれる。
  - `google_search_call.queries`(実行された検索クエリ一覧)
  - `google_search_result.search_suggestions`(UI表示が求められるHTML形式の「検索候補」。**Google側の利用規約でこの検索候補の表示が求められる可能性がある**ため、実装時に規約を精読する必要がある)
  - 本文中の`url_citation`アノテーション(URL・タイトル・文字位置)
- 課金はGemini 3系は検索クエリ実行ごと、Gemini 2.5以前はプロンプトごと。
- OpenAI同様、**明示的な「順位」は提供されない**。
- **モデル名はコードに固定しない。** OpenAI側と同様、呼び出すモデルIDは環境変数`GEMINI_AI_MEASUREMENT_MODEL`で指定し、運用側が選択・変更できるようにする。

---

## 5. citation/source URLの取得可否

- OpenAI・Geminiともに、回答本文の特定範囲に紐づく形でURL citationを取得できる。よって`AiObservation.citationsJson`への格納は技術的に可能。
- ただし以下の限界がある。
  - モデルが参照した全ソースが引用として明示されるとは限らない(OpenAIの`sources`は`citations`より広いことがある)。
  - 自院サイトが「引用されなかった」からといって「言及されなかった」とは限らない(本文中の言及とcitationは別軸)。
- したがって、citation取得可否と「clinic mention判定」(7章)は別ロジックとして扱う。

---

## 6. 推薦順位の定義

両API共通で、Google検索のような構造化ランキングは返らない。よって「推薦順位」は本文構造から**推定するしかない**。

- 定義: 「AI回答本文内での言及順による推定順位」とする。回答本文中で自院名または競合名が最初に言及された順序を`AiObservation.rank`に格納する。これは検索順位(SERP順位)ではない。
- 自院が言及されなかった場合は`rank = null`。
- **この`rank`を持つ観測値は、必ず`provisional = true`とする(任意ではなく必須のルールとする)。** 実装上も、rankを算出するロジックの出力に`provisional: true`を無条件に付与し、呼び出し側で外せないようにする。既存のUI(Phase 3で整備した日本語ラベリング層)にそのまま乗せられる。

---

## 7. clinic mention判定方法

- 医院の正式名称・通称・住所等のエイリアスリストを用意し、回答本文に対する正規化(全角/半角、法人格表記ゆれの除去等)した部分文字列マッチングで判定する(P0はシンプルな文字列マッチ、将来的に表記ゆれ吸収を強化)。
- マッチした場合、マッチ箇所のテキストスパンを`evidence`として保存する。

---

## 8. competitor抽出方法、およびGoogle AI Overviewsの扱い

### 8.1 competitor抽出の構造的な課題
現状、競合医院は`MockCompetitorProvider`による完全な架空データである。実際に「近隣の実在競合」を判定するには本来GBP等の実データが必要だが、これは今回明示的にスコープ外。

- P0での対応: 回答本文から「〜歯科」「〜デンタルクリニック」等のパターンで**実際に言及されている医院名候補のみを抽出する**(=実AIの回答に実際に出てきた文字列そのものを保存する)。
- 抽出した名称が「本当に近隣の競合医院か」を検証する手段は無いため、これは「AIの回答に出てきた医院名」という事実のみを保存し、「近隣競合リストとの突合」は行わない(将来、実CompetitorProvider/GBP連携ができてから対応)。
- **mockの架空競合リストとは実装上も絶対に混在させない。** 実測経路で生成した競合候補配列と、`MockCompetitorProvider`が生成する架空配列は、型・生成関数ともに分離し、同じ配列にマージするコードパスを作らない(18章のルール)。

### 8.2 Google AI Overviewsの扱い(2026-09-07: Gemini計測との分離を明確化)
公開情報を調査した結果、市場に出回っている「AI Overviews順位計測ツール」は、SerpAPI等のサードパーティ製SERP取得サービス経由であり、実質的にGoogle検索結果ページの自動取得(スクレイピング相当)に近く、Googleの利用規約上のリスクを伴いうる。

**結論: AI Overviewsそのものを公式に直接計測できる一般利用向けAPIは、P0では採用しない。** スクレイピングや非公式手段は前提にせず、Google AI Overviewsは独立providerとして今回は扱わない。将来、公式に利用可能な取得手段が明らかになった時点で改めて評価する。

**重要な区別: Gemini API + Google Search Groundingの結果を「Google AI Overviews実測」として扱ってはならない。** Google検索結果ページ上に表示されるAI Overviewsは、Gemini APIとは別のsurface(別のプロダクト・別の生成プロセス)であり、Gemini APIのgrounding応答を取得しても「AI Overviewsで何が表示されるか」を計測したことにはならない。したがってP0で扱うのは以下の2つのみとする。

- OpenAI Web Search API実測(A章参照)
- Gemini API + Google Search Grounding実測(A章参照)

Google AI Overviewsは、正式な計測方法(公式API等)が確認できるまで、別provider・future scopeとして扱う。

---

## 9. patient questionの実行方法

- 既存の`PATIENT_QUESTIONS`(6つの固定日本語質問)をそのまま流用する。
- **provider実装(`OpenAiProvider`/`GeminiProvider`)自体は、渡された質問が何問であっても動作するように作る。質問数をコード側で固定しない。** `observe()`は1問ずつ呼ばれる想定のインターフェースのままとし、「何問を実測対象にするか」は9章下記および16章のfeature flag/config側の責務とする。
- 各質問について、providerごとに1回ずつAPIを呼び出す(呼び出し回数は「実測対象として選ばれた質問数」に従う)。

---

## 10. region/location条件

- **OpenAI: structured `user_location`(approximate location: city/country/region/timezone)を優先して使う。** 医院所在地の情報が取得できる場合は、プロンプト文への地域埋め込みだけに頼る設計にはせず、必ず`user_location`パラメータへ構造化して渡す。プロンプト文中にも地域情報を記載してよいが、その場合は`user_location`の値と矛盾しないようにする(例: プロンプトで「〜市」と書きながら`user_location`に別の市を渡す、といった不整合を作らない)。
- Gemini: 現行ドキュメント上、`google_search` groundingツールに対する明示的なgeo制限パラメータは確認できなかった。そのため、プロンプト文中に地域情報を埋め込む方式で近似する(これはAPIのネイティブなgeo機能ではなく、プロンプトベースの近似であることを明記する)。Gemini側に将来structuredなlocation指定が追加された場合は、OpenAI側と同様に構造化パラメータを優先する方針に切り替える。
- 使用した地域情報(structured user_locationの値、またはプロンプト埋め込みの近似値)は`AiObservation.region`にそのまま保存する(既存カラム)。どちらの方式で地域条件を与えたか(structured/prompt-embedded)も判別できるようにする(11章の測定ロジックversionに含める案とする)。

---

## 11. model名・version保存方法(2026-09-07 確定)

未解決のままprovider実装へは進まない。以下を最低限、後から再現可能な形で保存する方針として確定する。

- `provider`: 既存の`AiObservation.provider`(`"chatgpt"` | `"gemini"`のような既存の識別子)をそのまま使う。表示ラベル変更は本設計のスコープ外(A章)。
- `model`(exact model ID): `AiObservation.model`に、実際に呼び出したモデルID(`OPENAI_AI_MEASUREMENT_MODEL`/`GEMINI_AI_MEASUREMENT_MODEL`で設定された値)をそのまま保存する。モデル名そのものはコードにハードコードしない。
- `tool type`: OpenAIなら`web_search`、Geminiなら`google_search`のような、使用したツール種別。
- `prompt / measurement logic version`: プロンプト文面やパース・判定ロジックのバージョンタグ(例: `openai_responses_web_search_v1`、`gemini_google_search_grounding_v1`)。取得方式・プロンプト・パースロジックは今後変わりうるため、モデル名だけでは区別がつかない。
- `measuredAt`/`capturedAt`: 12章の通り既存カラムをそのまま使う。

**格納先について、既存の`AiObservation`列だけでは`tool type`と`prompt / measurement logic version`を明示的に保持できない。** これは以下いずれかのschema変更案で対応する(**この設計書の範囲では提案のみとし、承認前にmigrationは作成しない**)。

- 案1(推奨): `AiObservation`に`toolType String?`と`measurementLogicVersion String?`の2カラムを追加する(既存データへの影響がないnullable追加カラムであり、破壊的変更ではない)。
- 案2: 新規カラムを増やさず、既存の`evidence`文字列の先頭に`[toolType:web_search][logicVersion:v1]`のようなタグを埋め込む(Phase 3の`parseEvidenceForDisplay`と同様、表示層でパースして除去する前提)。ただし検索・集計のしやすさでは案1に劣る。

実装着手時に、どちらの案を採るかをユーザーに確認した上でmigrationを作成する。

---

## 12. measuredAt/capturedAt

- `measuredAt` = 実際にAPIへリクエストを送信した時刻。
- `capturedAt` = 結果をDBに保存した時刻(リトライ等で差が生じうる)。
- どちらも既存カラムがそのまま使える。実測値をそのまま入れるだけで良い。

---

## 13. retry/timeout/rate limit

- タイムアウト: 1回のAPI呼び出しにつき20〜30秒程度を上限とする。
- リトライ: 一時的エラー(5xx・タイムアウト)に対して1回のみ、数秒待ってリトライする(無限リトライはしない)。
- レート制限: プロバイダごとに同時実行数を制限する(例: 同時2並列まで)。P0の呼び出し量は多くないため、複雑なキューイングやサーキットブレーカーは導入しない。

---

## 14. provider障害時のunavailableReason

障害発生時のマッピング案:

- タイムアウト・5xxが続く場合 → `temporarily_unavailable`
- APIキー不備・認証エラー → `fetch_failed`(ただしこれは運用上のアラート対象として別途ログ・通知すべき事象であり、ユーザー向け表示としてだけ処理して済ませるべきではない)
- レート制限超過 → `temporarily_unavailable`

**最重要ルール(ユーザー指定を再掲):**
- API失敗時に0点を付けない。
- mockへの黙示的フォールバックをしない。
- `unavailableReason`を必ず明示する。
- mock fallbackを使う場合は、該当項目または診断全体が「参考データ」であることを明確に表示する(Phase 3で整備したisSample/参考データ表示の仕組みをそのまま再利用できる)。

---

## 15. APIコスト概算方法(2026-09-07 改訂)

単純な「質問数×provider数×診断件数×単価」だけでは、両APIの実際の課金構造を反映できないため、以下のように要素を分解する。

**OpenAI側のコスト要素:**
- モデルのinput/output tokenコスト(設定されたモデルの料金に依存)。
- `web_search`ツールの呼び出し課金(ツールコールごとに発生)。
- 検索結果由来のcontent tokens(検索でヒットしたページ内容がモデルの入力コンテキストに取り込まれる分のtokenコスト。通常のプロンプトtokenより大きくなりうる)。

**Gemini側のコスト要素:**
- モデルのinput/output tokenコスト。
- Google Search Groundingの課金(Gemini 3系は検索クエリ実行ごと、Gemini 2.5以前はプロンプトごと)。
- **1回のプロンプトに対して複数の検索クエリが実行される可能性がある**(`google_search_call.queries`が複数件になりうる)ため、「1回answer=1回検索」という前提を置かない。

**概算式(設計時点):**
`1医院あたりのコスト ≈ Σ_質問 [ (input tokenコスト + output tokenコスト) + (tool/grounding呼び出し課金 × 実行された検索回数) + 検索結果由来content tokenコスト ]`、これを実測対象質問数・provider数・診断件数/月で積み上げる。

- **実際の単価(token単価、tool呼び出し単価)は実装着手時に両社の最新公式価格ページで確認し、運用側が参照する。コード上に固定値としてハードコードしない**(HANDOFF.md §35「料金をコード固定しない」原則に準拠)。設計時点では上記の概算式・要素分解のみ提示する。
- **実装後は、provider response/usageフィールド(OpenAIのusageオブジェクト、Geminiのusageメタデータ)から実際のtoken数・検索回数を取得し、実使用量ベースでコストを計測できる構造にする。** これにより概算値ではなく実測コストをモニタリングできるようにする(具体的なログ/集計先は実装時に設計する)。

---

## 16. 1医院あたり何質問をP0で実測するか

- 全6問をいきなり実測にするとコスト・レイテンシ・失敗率のリスクが大きい。
- **provider自体は6問すべてに対応できる実装とし、コード上で質問数を固定しない。** その上で、P0の実運用ではfeature flag/config(例: `AI_MEASUREMENT_QUESTION_KEYS`のような、実測対象とする質問キーのリストを外部設定で指定する仕組み)によって、6問のうち中心的な2〜3問のみを実測対象とし、残りは当面mock(参考データ)のまま維持することを推奨する。
- 対象質問キーの選定・変更は設定変更のみで行え、コード修正を必要としない構造にする。
- 実測が安定した段階で、設定変更のみで対象質問数を段階的に拡大できる。
- **重要**: 一部の質問だけ実測・残りmockという状態は「診断内でのmockと実測の混在」にあたるため、18章のルールに従い、質問ごとのsourceTypeをUI上でも区別できるようにする(Phase 3で「詳細を見る」内にprovider表示済みのため、そこにsourceTypeも反映させる想定)。

---

## 17. sourceType/provisional/isSampleの切り替え

- `sourceType`: 既存の`DataSource`型の`"ai_provider"`(実測)と`"mock"`をそのまま使う。新しい型追加は不要。
- `provisional`: 「推定・ヒューリスティックな値であるか」を示すフラグとして使う。たとえば実測データであっても、6章の「推定順位」のように本文から推定した値は`provisional = true`とする。sourceType(どのシステムが作ったか)とprovisional(推定かどうか)は独立した軸として扱う。
- `isSample`(診断全体): 全ての`AiObservation`が`sourceType = "ai_provider"`である場合のみ`false`にする。1問でもmockが残っていれば、診断全体としての`isSample`は`true`のまま維持する(=部分的に実測でも、全体としては「参考データを含む」表示を継続する)。
  - より粒度の細かい「質問ごとの参考データ表示」が必要な場合は、既存の`isSample`(診断単位)に加えて質問単位のフラグ導入を検討する(P0では既存の`isSample`のみで対応し、UIの「詳細を見る」内でprovider/sourceTypeを個別表示する形で当面カバーする)。

---

## 18. mockと実測を混ぜないルール

- スコアや件数を集計する際、`sourceType`の異なる観測値を暗黙的に平均・合算しない。
- `buildScoreBreakdown()`・`computeIsSample()`は、各観測値の`sourceType`を見て、mockが1件でも混ざっていれば診断全体を「参考データを含む」として扱う(17章と同じ考え方)。
- 競合抽出についても、mockの架空競合リストと実AIの回答から抽出した実在候補名を同じ配列にマージしない(8.1節)。

---

## 19. セキュリティ/APIキー管理

- OpenAI/GeminiのAPIキーは環境変数経由でのみ扱い、リポジトリにコミットしない。
- 既存のprovider(server-side実行)と同じく、キーはサーバー側でのみ読み込み、クライアントに露出させない。
- デプロイ環境のシークレット管理機構(`.env.local`等の既存運用)にそのまま乗せる。キーのローテーションがしやすいよう、ビルド時埋め込みではなく実行時読み込みにする。

---

## 20. unit/integration test方針

- **Unit test**: HTTPクライアント/SDK呼び出し自体はモック化し、固定のAPIレスポンス(fixture JSON)に対して「citation抽出」「mention判定」「rank推定」等のパースロジックを検証する。CIでは実ネットワーク呼び出しを行わない。
- **Integration test**: 実APIを叩く確認は、CIには組み込まず、実装者が手動で(コストを意識しながら)ローカル/検証環境で行うスクリプトとして用意する程度に留める。
- 既存の`diagnosisFlow.test.ts`・`resultViewModel.test.ts`等には触れない。新規provider用のテストファイルを追加する形にする。

---

## 21. 変更予定ファイル

- 新規: `src/server/providers/ai/openAiProvider.ts`(`AiProvider`実装)
- 新規: `src/server/providers/ai/geminiProvider.ts`(`AiProvider`実装)
- 新規: provider選択用のfeature flag解決処理(例: `src/server/providers/ai/resolveAiProviders.ts`)
- 変更(最小限): `runFreeDiagnosis.ts`の呼び出し元(providerインスタンスを組み立てている箇所)のみ。スコアリング・root causeロジックには触れない。
- 場合により: `prisma/schema.prisma`に取得方式を示す小さな追加カラム(11章)。追加する場合は新規マイグレーションが必要。
- 新規テスト: `tests/unit/openAiProvider.test.ts`、`tests/unit/geminiProvider.test.ts`(fixtureベース)。
- `.env.example`等への追加項目: `OPENAI_API_KEY`、`OPENAI_AI_MEASUREMENT_MODEL`、`GEMINI_API_KEY`、`GEMINI_AI_MEASUREMENT_MODEL`、`AI_PROVIDER_MODE`、実測対象質問キー設定(16章)。
- **変更しない**: `diagnosisRepository.ts`、`aioLossAttribution.ts`、`src/domain`配下の型定義、`runFreeDiagnosis.ts`のスコアリング・root cause attributionロジック本体(既存のまま受け入れ可能なことを確認済み。ユーザー指示7番の通り、これらのロジックには一切手を入れない)。

---

## 22. 実装順序(案)

1. `OpenAiProvider`/`GeminiProvider`をfixtureベースのunit testとともに実装する。feature flagはデフォルトOFF(既存のmock動作に影響を与えない)。
2. Composition root(providerを組み立てている箇所)でfeature flag経由の切り替えを配線し、既存mockパスが壊れていないことを回帰確認する。
3. 開発/検証環境限定で、実APIキーを使った小規模な手動疎通確認(コスト上限を決めた上で、1医院・縮小した質問数)を行う。
4. 17〜18章の「mockと実測混在時の表示ルール」が実際のUIで正しく機能するか確認する(部分的に実測にした場合でも「参考データ」表示が正しく維持されるか)。
5. 社内・限定ユーザー向けにfeature flagを有効化し、実測を試験運用する。
6. コスト・安定性を見ながら、対象質問数・provider範囲を段階的に拡大する。

(Google AI Overviews providerおよび実CompetitorProvider/GBP連携は、本設計の対象外として今回は着手しない。)

---

## A. 呼称の定義について(2026-09-07 確定・最重要事項)

ユーザー指摘の通り、**API経由の回答は、一般ユーザーがChatGPT/GeminiのWeb画面/アプリで見る回答と同一ではない**。理由:

1. モデルの違い: 消費者向けアプリは複数モデルを動的にルーティングする可能性があり、APIで明示的に指定するモデル(`OPENAI_AI_MEASUREMENT_MODEL`/`GEMINI_AI_MEASUREMENT_MODEL`で設定した値)と必ずしも一致しない。
2. 非公開コンテキストの違い: 消費者向けアプリには会話履歴・パーソナライゼーション・システムプロンプト等、API呼び出しには存在しない文脈が影響しうる。
3. 検索実行の内部ロジックの違い: 消費者向けUIがいつ・どうWeb検索を行うかの内部ロジックは、API呼び出し時の`web_search`/`google_search`ツールの挙動と同一である保証がない。

**したがって「ChatGPT実測」「Gemini実測」という呼称は禁止し、以下の呼称に統一する。**

| 禁止する呼称 | 正しい呼称 |
| --- | --- |
| ChatGPT実測 | OpenAI Web Search API実測 (別名: OpenAI検索API計測) |
| Gemini実測(単体) | Gemini API + Google Search Grounding実測 |

- **OpenAI Web Search API実測**の定義: 「公式OpenAI API(Responses API + `web_search`ツール、`OPENAI_AI_MEASUREMENT_MODEL`で指定したモデル)を用いて、DENT SHIFTが設計した患者質問プロンプトに対する応答を取得したもの」。これは消費者向けChatGPTアプリ/Web画面での検索結果そのものではない。
- **Gemini API + Google Search Grounding実測**の定義: 「公式Gemini API(`google_search` groundingツール、`GEMINI_AI_MEASUREMENT_MODEL`で指定したモデル)を用いて取得した応答」。これは消費者向けGeminiアプリの回答、またはGoogle検索のAI Overviewsで表示される結果そのものではない(8.2節参照)。
- **コード・DB上の内部識別子**(`AiObservation.provider`の値である`"chatgpt"`/`"gemini"`等)は既存のまま変更しない。呼称のルールは表示文言・ドキュメント上の呼び方に適用する。
- **UI表示について**: メイン画面で将来的に短く「ChatGPT」「Gemini」と表示する場合(既存の`PROVIDER_LABEL_JA`のような簡易ラベル)があっても、詳細表示・「計測条件について」等では、必ず「OpenAI Web Search API実測」「Gemini API + Google Search Grounding実測」であることを明示し、消費者向けアプリの検索結果と同一であるかのような表現をしない。**ただし表示文言そのものの変更は今回の実装スコープ外とし、設計上の申し送り事項として記録するのみとする。**

---

## B. 表示・データ整合性ルール(再確認)

- 実providerで取得したものだけを`measured`/実測として扱う。
- API失敗時: 0点にしない/mockへ黙示的にフォールバックしない/`unavailableReason`を明示する。
- mock fallbackを使う場合、診断全体または該当項目が「参考データ」であることを明確に表示する(Phase 3で整備済みの表示層をそのまま活用可能)。

---

## C. 「検索が本当に実行されたか」の判定・保存(2026-09-07 追加)

**APIを呼んだだけで「検索実測済み」と判定してはならない。** OpenAI・Geminiともに、モデルがツールを使わず内部知識だけで回答することがあり得るため、以下を区別して判定・保存する。

- search tool callが実際に発生したか: OpenAIは応答内に`web_search_call`アイテムが存在するか、Geminiは`google_search_call`(実行された検索クエリ情報)が存在するかで判定する。
- 実行された検索query: 発生した場合、OpenAIは`web_search_call`のaction情報、Geminiは`google_search_call.queries`から実際に投げられたクエリ文字列を取得し保存する。
- citationが返ったか: 本文中に`url_citation`アノテーションが1件以上存在するか。
- 検索無しでモデル回答だけだったか: 上記のいずれも発生しなかった場合、「検索なしのモデル単独回答」として明示的に区別する。

**これらの判定結果を`AiObservation`に保存し(例: `searchExecuted: boolean`、実行された検索クエリの配列)、検索が実行されていない観測は「Web検索実測」として扱わない。** 検索が実行されていない場合の扱い(mock相当の参考データとするか、`unavailableReason`の一種として扱うか)は実装時に確定するが、少なくとも「search tool callなしの回答」を「Web検索による実測」とラベリングしてはならない、という制約を設計として確定する。

`AiObservation`にこの判定結果を保存するための具体的なカラム追加は、11章のschema変更案とあわせて実装着手時に確定し、承認前にmigrationは作成しない。

---

## D. measured質問とmock質問を同一AIOスコアへ混ぜない確定ルール(2026-09-07 追加)

P0で6質問中2〜3質問のみ実測し、残りをmockにする方針自体は維持する。ただし、**実測2〜3質問+mock3〜4質問を合算して「1つの実測AIOスコア」にすることは絶対に行わない。** 以下を確定ルールとする。

- 実測が行われた質問 → `measured`として扱う。
- 未実測(mock)の質問 → `reference`/`sample`として扱う(「実測」とは呼ばない)。
- **実測coverageを明示する。** 例: 「3 / 6 questions measured」のような形で、診断内の何問が実測かをデータとして保持し、UIでも表示できるようにする。
- AIOスコアの集計は、実測と参考データが混在する場合は**partial扱い**とする。「6問すべて実測した場合のAIOスコア」と同じ意味・同じ確度のスコアとして提示しない。
- **mockの観測値はmeasured scoreの計算へ含めない。** 実測のみで完結するスコアと、mockを含む参考スコアを明確に分離する(必要なら両方を保持し、UIでは参考スコアを主表示、実測スコアを「実測分のみ」として詳細に表示するなど、具体的なUI設計は今後別途行う)。
- 不足分(未実測の質問)を0点にすることも、黙ってmockで補完して「6問満点相当」であるかのような100点満点スコアにすることも、どちらも禁止する。
- `Diagnosis.isSample`は、診断内にsample/mockの観測が1件でも残っている限り`true`のままとする(17章のルールを再確認・強化するものであり、変更ではない)。

---

## E. recommendation_rankのfield-level provenance(2026-09-07 追加)

両APIとも構造化された検索順位を返さないため、「回答本文に医院名/競合名が出た順番」は`measured rank`ではなく、**derived / estimated / provisional な値**である。この性質は、観測全体(`AiObservation`)が実API由来(`sourceType: "ai_provider"`)であっても失われない。

- `AiObservation`全体の`sourceType`が実測(`ai_provider`)であっても、そこから導出した`rank`フィールド自体は常に`provisional = true`を維持する(6章のルールの再確認)。
- **`recommendation_rank`のようなcriterionへこの値を使う場合も、「実測順位」として扱ってはならない。** 表示・スコアリングの両方で「本文内言及順による推定順位」であることが失われない設計にする。
- 必要に応じてfield-level provenance(例: `rankSource: "text_mention_order_estimate"`のような、観測全体のsourceTypeとは別に、個々のフィールドがどのように導出されたかを示す属性)を追加する。具体的なデータ構造(既存フィールドへの属性追加か、別テーブルかなど)は実装着手時に確定する。

---

## F. competitor抽出における確認レベルの分離(2026-09-07 追加)

AI回答本文に医院名らしき名前が出ただけで、「実在する競合医院」と確定してはならない。以下の確認レベルを分けて扱う。

1. **AI回答内mention**: 回答本文に「〜歯科」等のパターンで名称が出現したという事実のみ。
2. **citation URLとの整合**: その名称の近くに引用されたcitation URLが存在し、URLのドメイン名等が名称と整合するか。
3. **既知の競合リストとの一致**: 別途保有する既知の競合医院リスト(P0では未整備。将来のCompetitorProvider/GBP連携時に利用)と一致するか。
4. **公式URL等での確認**: その医院の公式サイトの存在が別途確認できているか。

**P0時点では1と2までしか確認できない見込みであり、3・4は将来のCompetitorProvider/GBP連携(今回スコープ外)に持ち越す。** 確認できていない名称は、`competitor candidate`(または「AI回答内の競合候補」)として`provisional`扱いとし、8.1節で述べた「mockの架空競合リストとは絶対に混在させない」ルールとあわせて、実在確定済みの競合として扱わない。

---

## G. citation判定ルール(自院公式サイトの判定)(2026-09-07 追加)

citation URLを取得できるだけでは不十分であり、**「citationが存在する」と「自院公式サイトがcitationされた」を明確に分離する。** 自院citationかどうかを判定するため、少なくとも以下をどう扱うか設計する。

- official clinic domain: 医院の登録済み公式ドメインとの比較対象を明確にする。
- www有無: `example.com`と`www.example.com`を同一ドメインとして扱う。
- subdomain: `clinic.example.com`のようなサブドメインをどこまで同一医院とみなすか。
- trailing slash: `https://example.com`と`https://example.com/`を同一とみなす。
- URL正規化: プロトコル(http/https)、大文字小文字、末尾スラッシュなどを正規化した上で比較する。
- redirect: citation URLがリダイレクトを経由する場合、最終的な到達先ドメインで判定するか、citationに記載された元URLで判定するかを明確にする(P0ではリダイレクト追跡は行わず、記載URLをそのまま正規化して判定する案とし、必要なら将来拡張する)。
- tracking parameter: `?utm_source=...`等のクエリパラメータはドメイン一致判定に影響させない(ドメイン・パスのみで判定し、クエリパラメータは無視する)。

上記の正規化ルールに基づいて「自院公式サイトのドメインと一致するcitationが存在するか」を判定し、これを`AiObservation`の`mention`判定やevidenceとは別に、citationレベルの事実として保存する。**「citationが存在する」ことと「自院公式サイトがcitationされた」ことは、異なる意味を持つ別々のデータとして扱う。**

---

## H. Geminiの利用規約確認(live provider有効化前の必須ブロッキング事項)(2026-09-07 追加)

4章で述べた通り、Gemini API + Google Search Groundingのレスポンスには`google_search_result.search_suggestions`(UI表示が求められるHTML形式の「検索候補」)が含まれる可能性があり、Googleの利用規約上、これを表示する義務が課されている可能性がある。

**この確認は「後で確認」する事項ではなく、Gemini providerをlive(実測)として有効化する前に必ず完了しなければならないブロッキング事項として扱う。** 具体的には以下を、Gemini provider実装後・feature flagで実運用を有効化する前に確認する。

- Gemini API利用規約(Gemini API Additional Terms of Service等)を精読し、`search_suggestions`の表示義務の有無・内容を確認する。
- 表示義務がある場合、DENT SHIFTの無料診断結果画面のどこに、どのような形でこれを表示する必要があるかを別途設計する(本設計書のスコープ外の追加作業として扱う)。
- この確認が完了し、必要な対応方針が定まるまで、Gemini providerのfeature flagを本番相当の環境で有効化しない。

---

## I. P0における「measured」「estimated」「reference」用語表(2026-09-07 確定)

| 対象 | 呼称 | 説明 |
| --- | --- | --- |
| OpenAI Web Search API経由で、search tool callが実際に発生した観測 | **measured**(OpenAI Web Search API実測) | `web_search_call`の発生とcitation/検索クエリの取得を確認できたもの |
| Gemini API + Google Search Grounding経由で、search tool callが実際に発生した観測 | **measured**(Gemini API + Google Search Grounding実測) | `google_search_call`の発生を確認できたもの |
| OpenAI/GeminiのAPIを呼んだが、search tool callが発生しなかった応答 | **reference**(検索なしのモデル単独回答) | 「Web検索実測」とは呼ばない(C章) |
| 回答本文内の言及順から導出した`rank` | **estimated / provisional** | 観測全体がmeasuredでも、rank自体は常にprovisional(E章) |
| AI回答本文にのみ出現した競合医院候補(citation・既知リスト・公式URLで未確認) | **estimated / provisional**(competitor candidate) | 実在確定済みの競合としては扱わない(F章) |
| P0でfeature flag/configにより実測対象としなかった質問の観測(mock) | **reference / sample** | measured scoreの計算に含めない(D章) |
| Google AI Overviews | **P0では計測対象外(future scope)** | 公式な計測方法が確認できるまで別provider扱い(8.2節・9番) |

以上が実AI計測providerのP0設計案(2026-09-07改訂版)である。**本設計書についてユーザーの最終確認・承認を得るまで、コード実装(OpenAiProvider/GeminiProvider実装、feature flag実装、APIキー接続、env追加、runFreeDiagnosisへの実provider接続、scoring変更、root cause変更、Prisma変更、migration作成を含む)には着手しない。**
