# 改善TOP3ロジック — 45項目カタログ ↔ 6領域サブcriterion 対応関係レビュー(2026-09-05 構造再整理版)

作成日: 2026-09-05(初版) / 更新日: 2026-09-05(1回限りの構造再整理を反映)
対象コード: `src/domain/improvement-task/candidateCatalog.ts`, `src/domain/improvement-task/types.ts`, `src/domain/improvement-task/priorityScoring.ts`
対象データ: `docs/source/DENT_SHIFT_AI改善アクション生成ロジック_Ver1.pdf`(45項目カタログ)× `src/domain/diagnosis/scoreCriteria.ts`(6領域×5サブcriterion=30項目)

**このドキュメントはレビュー資料です。今回の変更範囲は改善TOP3ロジック(domain/runFreeDiagnosis/unit tests)に限定しており、UI・Google連携・DB・認証・決済・アンバサダー・医療広告AIチェックには着手していません。**

---

## 0. 前提(重要)

正本は「AI集患総合スコア診断ロジック」(6領域×5サブcriterion=30項目の配点表)と「AI改善アクション生成ロジック」(45項目の検出カタログ)という**別々の2文書**であり、両者を紐付ける対応表そのものが、いずれの正本にも存在しません。

したがって、以下の45項目すべての診断根拠(`diagnosticAnchor`)への紐付けは、**実装時点でこちらが行った解釈であり、「DENT SHIFT正式仕様」ではなく全件「暫定マッピング」(`provisional: true`)です**。実プロバイダー接続後、より具体的な一次シグナル(例: NAP文字列の実照合結果、実際のクロールログ等)が使えるようになった段階で、項目単位で`provisional`を`false`へ切り替えられる設計にしています(初版からの変更なし。今回の再整理でも維持)。

初版レビュー後、以下6点の構造再整理を1回限り実施しました(45項目を正式仕様として固定しないための整理であり、45項目自体の入れ替え・削除は行っていません)。

### 0.1 diagnosticAnchor / triggerRules[] / evidenceRequirements[] への分離(旧primaryCriterion の位置づけ変更)

初版では各項目が単一の`primaryCriterion`を持ち、「このcriterionが低ければこの項目が発火する」という単一の発火条件として扱っていました。今回、これを3つの役割に分離しました。

- **`diagnosticAnchor`**: この候補が主に参照する評価根拠(1つのcriterion)。監査・表示用の「代表的な根拠」であり、**唯一の発火条件という意味は持たせていません**。
- **`triggerRules[]`**: 実際の発火条件(複数条件をAND評価できる配列)。P0では各項目とも`diagnosticAnchor`に対する単一条件(`ratio_below`: 達成率がしきい値未満)のみを持ちますが、将来「複数criterionが同時に悪いときだけ発火」といった条件を追加できる構造にしてあります。
- **`evidenceRequirements[]`**: この候補を生成してよいかの可用性ゲート。列挙されたcriterionのいずれかが`unavailable`(測定不能)の場合、この候補はそもそも生成しません(0.4節参照)。

しきい値そのもの(達成率<0.34でescalation対象、<0.6でそれ以外)は初版から変更していません。この数値も正本には明記がなく、実データ調整を前提とした暫定値です(正本§12「各検出閾値と優先度点数の実データ調整」が検証事項としている論点と同種)。

### 0.2 rootCauseKeyによる重複整理(旧: 「同一criterionを複数項目で共有」問題への対応)

初版では、30criterionに対して45項目をマッピングしているため複数項目が同じcriterionを参照しており、「同じデータ状況で複数項目が同時に発火し得る」ことを既知の制約として記載していました。今回、これを次の方針で整理しました。

- 各項目に`rootCauseKey`(`${evidenceDomain}:${criterionKey}`の形式)を付与しました。
- **standard種別(通常の改善提案)の候補のうち、同一`rootCauseKey`を持つものは、TOP3選定前に`deduplicateByRootCause()`で最も優先度スコアの高い1件だけを代表として残し、他は候補から除外します**(=単なるmockの値が同じというだけで独立evidenceなしに複数項目を同時提示しない)。代表としてどの項目が残るかは診断時の実際のスコア(4軸優先度スコア→urgency→catchmentImpact→rippleEffect→easeOfExecution→domain順→key順のタイブレーク)に応じて動的に決まるため、本ドキュメントでは固定していません。
- **重大リスクエスカレーション(`risk_escalation`)はこの重複整理の対象外**です。同じ`rootCauseKey`をescalationとstandardが共有する場合(例: `WEB_BOOKING:form_usability`のbooking-form-error[escalation]とbooking-too-many-fields/booking-popup-interferes[standard])、escalation側は重複整理に関わらず必ず残り、通常のランキングより優先して表示されます。standard側だけがこの2件→1件の集約対象になります。
- 質問結果(実際のAI回答テスト)由来の`aio-losing-patient-questions`は、criterion達成率とは独立した実evidence(個別の質問ごとの勝敗)を持つため、他候補と衝突しない専用の`rootCauseKey`(`adhoc:aio-losing-patient-questions`)を振っており、重複整理の対象になりません。

以下は、同一`rootCauseKey`(`${evidenceDomain}:${criterionKey}`)を共有する13グループの一覧です(初版の「0.1 同一criterionを複数項目で共有している箇所」を、重複整理のグループ定義として引き継いだもの)。

| rootCauseKey | 共有している項目(key) | 重複整理の効き方 |
|---|---|---|
| AIO:information_accuracy | aio-basic-info-mismatch(escalation), aio-doctor-info-missing(standard) | standardが1件のみのため実質的に集約なし |
| AIO:question_domain_coverage | aio-abstract-treatment-desc, llmo-no-direct-answer | standard2件→1件に集約 |
| LLMO:content_clarity | llmo-generic-only, llmo-no-comparison-info | standard2件→1件に集約 |
| LLMO:info_consistency | llmo-entity-ambiguous(standard), llmo-info-outdated-conflicting(escalation) | standardが1件のみのため実質的に集約なし |
| LLMO:content_provenance | aio-update-date-unclear, llmo-third-party-evidence-missing | standard2件→1件に集約 |
| MEO:gbp_content_richness | meo-hours-outdated(escalation), meo-service-info-missing(standard) | standardが1件のみのため実質的に集約なし |
| MEO:photo_activity | meo-photos-scarce-old, meo-posts-qa-neglected | standard2件→1件に集約 |
| SEO:site_structure | seo-title-heading-duplicate, seo-internal-links-missing, seo-duplicate-canonical | standard3件→1件に集約 |
| WEB_BOOKING:booking_funnel_flow | booking-link-broken(escalation), booking-phone-invalid(escalation), booking-too-many-steps(standard) | standardが1件のみのため実質的に集約なし |
| WEB_BOOKING:form_usability | booking-form-error(escalation), booking-too-many-fields(standard), booking-popup-interferes(standard) | standard2件→1件に集約 |
| WEB_BOOKING:pre_booking_reassurance | booking-no-auto-reply, booking-info-insufficient | standard2件→1件に集約 |
| REVIEWS:response_quality | reviews-no-response, reviews-negative-neglected | standard2件→1件に集約 |
| REVIEWS:policy_risk | reviews-response-contains-pii, reviews-exaggerated-claims, reviews-incentivized-reviews | 全件escalationのため集約なし(3件とも常に残る) |

上記に含まれない残り32項目は、他項目とrootCauseKeyを共有しない単独対応です(初版の「15項目」から件数の数え方を「グループ内の項目」から「rootCauseKey単位」に統一したための差分であり、対応関係自体に変更はありません)。

### 0.3 displayDomain / evidenceDomain の分離(旧: 「領域をまたぐ」項目への対応)

初版では、カタログ上の表示領域(category)と実際に参照しているcriterionの領域が異なる4件を「領域をまたぐ暫定マッピング」として注記していました。今回、これを構造として正式に分離しました。

- **`displayDomain`**: ユーザーに表示する領域(正本カタログの章。既存UI互換の`domain`フィールドと同値)。
- **`evidenceDomain`**: 診断根拠(`diagnosticAnchor`)が属する領域。

両者が異なること(cross-domain)自体は**不具合として扱いません**。「AIO向けの表示だがLLMO側のcriterionを根拠にする」といった、正当な設計として位置づけています。該当する4件は以下のとおりです(対応関係自体は初版から変更なし)。

| improvement key | displayDomain | evidenceDomain |
|---|---|---|
| aio-structured-data-missing | AIO | LLMO |
| aio-update-date-unclear | AIO | LLMO |
| aio-crawl-blocked | AIO | LLMO |
| llmo-no-direct-answer | LLMO | AIO |

### 0.4 evidence不足時に推測発火しないこと(evidenceRequirements[]の可用性ゲート)

`evidenceRequirements[]`に列挙されたcriterionのいずれかが`unavailable`(測定不能)の場合、その候補はそもそも生成しません。domain全体が丸ごと`unavailable`な場合は1件のdata_gap候補にまとめる一方、domainの一部criterionだけが`unavailable`な場合(他のcriterionは測定できている)は、そのcriterionのみを根拠とする候補だけを個別に生成しない、という挙動です。いずれの場合も、**測定できていないevidenceの代わりに独立した仮のシグナルを捏造して発火させることはしません**。これは初版の実装からロジック自体は変わっていませんが、`evidenceRequirements[]`という明示的なフィールドとして構造化し、unit testでも検証しています。

### 0.5 provisionalフィールド(初版から維持)

45項目カタログ由来の候補はすべて`provisional: true`です。data_gap(データ不足)候補や、質問結果由来の`aio-losing-patient-questions`のように、45項目カタログのcriterion対応マッピングに依存しない候補は`provisional: false`とし、区別しています。実データ・正式な対応表で検証できた項目から、`candidateCatalog.ts`側で個別に`provisional: false`へ更新できる設計です。

---

## 1. AIO(正本§2、7項目)

| improvement key | improvement label | displayDomain | evidenceDomain | diagnosticAnchor(criterionKey) | 発火条件 | なぜそのcriterionに紐付けたか | escalation対象か | provisional |
|---|---|---|---|---|---|---|---|---|
| aio-basic-info-mismatch | 医院基本情報がページごとに不一致 | AIO | AIO | information_accuracy | 達成率<0.34 | 基本情報の不一致は「情報の正確性」の毀損と直接対応すると判断 | ○(clinic_info_mismatch) | true(暫定マッピング) |
| aio-abstract-treatment-desc | 診療内容の説明が抽象的 | AIO | AIO | question_domain_coverage | 達成率<0.6 | 治療内容の具体性は、患者の質問領域にどれだけ答えられているかの指標に近いと判断 | — | true(暫定マッピング) |
| aio-faq-missing | FAQが不足 | AIO | AIO | citation_acquisition | 達成率<0.6 | FAQ充実はAIが引用しやすいコンテンツを増やす効果があり「引用・リンク獲得」に最も近いと判断 | — | true(暫定マッピング) |
| aio-doctor-info-missing | 医師情報・監修者が不明 | AIO | AIO | information_accuracy | 達成率<0.6 | 医師・監修者情報の欠如も「情報の正確性」の一種として扱った(rootCauseKey共有: AIO:information_accuracy) | — | true(暫定マッピング) |
| aio-structured-data-missing | 構造化データが不足 | AIO | LLMO | structured_data | 達成率<0.6 | 「構造化データ」はLLMOのスコア基準にそのまま定義されているため、AIO章の項目だがLLMO側のcriterionを直接参照した(cross-domain) | — | true(暫定マッピング) |
| aio-update-date-unclear | 更新日・根拠が不明 | AIO | LLMO | content_provenance | 達成率<0.6 | 「更新日・根拠の明示」はLLMOの「情報の根拠・更新性」の定義と一致すると判断(cross-domain) | — | true(暫定マッピング) |
| aio-crawl-blocked | クロール阻害・重要情報が画像のみ | AIO | LLMO | crawler_access | 達成率<0.34 | 「クロール阻害」はLLMOの「AIクローラーのアクセス」の定義そのものであるため(cross-domain) | ○(ai_crawler_failure) | true(暫定マッピング) |

## 2. LLMO(正本§3、6項目)

| improvement key | improvement label | displayDomain | evidenceDomain | diagnosticAnchor(criterionKey) | 発火条件 | なぜそのcriterionに紐付けたか | escalation対象か | provisional |
|---|---|---|---|---|---|---|---|---|
| llmo-generic-only | 医院の特徴が一般論のみ | LLMO | LLMO | content_clarity | 達成率<0.6 | 内容が一般論に留まる状態を「コンテンツの理解しやすさ・独自性」の欠如と判断 | — | true(暫定マッピング) |
| llmo-entity-ambiguous | エンティティ情報が曖昧 | LLMO | LLMO | info_consistency | 達成率<0.6 | 医院・医師・診療領域の関係の曖昧さを「医院情報の一貫性」の一種として扱った | — | true(暫定マッピング) |
| llmo-third-party-evidence-missing | 第三者根拠が不足 | LLMO | LLMO | content_provenance | 達成率<0.6 | 第三者根拠の不足を「情報の根拠・更新性」の欠如の一種とみなした(rootCauseKey共有: LLMO:content_provenance) | — | true(暫定マッピング) |
| llmo-no-direct-answer | 質問に対する直接回答がない | LLMO | AIO | question_domain_coverage | 達成率<0.6 | 患者質問への直接回答力は、AIOの「質問領域の広さ」の定義に最も近いと判断し、AIO側のcriterionを参照した(cross-domain) | — | true(暫定マッピング) |
| llmo-no-comparison-info | 比較・選び方情報がない | LLMO | LLMO | content_clarity | 達成率<0.6 | 比較・選択基準の説明のわかりやすさも「コンテンツの理解しやすさ」に含めた(rootCauseKey共有: LLMO:content_clarity) | — | true(暫定マッピング) |
| llmo-info-outdated-conflicting | 情報が古い・矛盾 | LLMO | LLMO | info_consistency | 達成率<0.34 | 情報の古さ・矛盾は「医院情報の一貫性」の毀損そのものと判断(rootCauseKey共有: LLMO:info_consistency) | ○(clinic_info_mismatch) | true(暫定マッピング) |

## 3. MEO(正本§4、7項目)

| improvement key | improvement label | displayDomain | evidenceDomain | diagnosticAnchor(criterionKey) | 発火条件 | なぜそのcriterionに紐付けたか | escalation対象か | provisional |
|---|---|---|---|---|---|---|---|---|
| meo-nap-mismatch | NAP情報が不一致 | MEO | MEO | gbp_basic_safety | 達成率<0.34 | NAP(名称・住所・電話)の一致はGBPの「基本設定・安全性」の根幹をなすと判断 | ○(clinic_info_mismatch) | true(暫定マッピング) |
| meo-hours-outdated | 診療時間・休診情報が古い | MEO | MEO | gbp_content_richness | 達成率<0.34 | 診療時間情報を「情報・診療内容の充実」の一項目として扱った | ○(clinic_info_mismatch) | true(暫定マッピング) |
| meo-category-mismatch | 主カテゴリ・副カテゴリが不適切 | MEO | MEO | map_visibility | 達成率<0.6 | カテゴリ設定はマップでの表示・検索ヒット率に直結するため「Googleマップ表示状況」に紐付けた | — | true(暫定マッピング) |
| meo-service-info-missing | サービス情報が不足 | MEO | MEO | gbp_content_richness | 達成率<0.6 | 診療項目情報の充実度そのものと判断(rootCauseKey共有: MEO:gbp_content_richness) | — | true(暫定マッピング) |
| meo-photos-scarce-old | 写真が少ない・古い | MEO | MEO | photo_activity | 達成率<0.6 | 「情報発信・写真の運用」の定義そのもの | — | true(暫定マッピング) |
| meo-booking-link-broken | 予約リンク切れ・誤誘導 | MEO | MEO | booking_funnel_meo | 達成率<0.34 | GBP上の予約導線は「来院・予約への導線」の定義と直接対応 | ○(booking_failure) | true(暫定マッピング) |
| meo-posts-qa-neglected | 投稿・Q&Aが放置 | MEO | MEO | photo_activity | 達成率<0.6 | 投稿・Q&Aの運用状況も「情報発信」活動の一種とみなした(rootCauseKey共有: MEO:photo_activity) | — | true(暫定マッピング) |

## 4. SEO(正本§5、7項目)

| improvement key | improvement label | displayDomain | evidenceDomain | diagnosticAnchor(criterionKey) | 発火条件 | なぜそのcriterionに紐付けたか | escalation対象か | provisional |
|---|---|---|---|---|---|---|---|---|
| seo-index-noindex-issue | index/noindex設定の不備 | SEO | SEO | crawl_index | 達成率<0.34 | 「クロール・インデックス」の定義そのもの | ○(ai_crawler_failure) | true(暫定マッピング) |
| seo-title-heading-duplicate | タイトル・見出しの重複 | SEO | SEO | site_structure | 達成率<0.6 | タイトル・見出し設計をサイト構造・ページ設定の一部として扱った | — | true(暫定マッピング) |
| seo-thin-treatment-pages | 診療ページが薄い | SEO | SEO | content_quality | 達成率<0.6 | 「診療コンテンツの品質」の定義そのもの | — | true(暫定マッピング) |
| seo-internal-links-missing | 内部リンクが不足 | SEO | SEO | site_structure | 達成率<0.6 | 内部リンク設計もサイト構造の一部とみなした(rootCauseKey共有: SEO:site_structure) | — | true(暫定マッピング) |
| seo-slow-mobile-performance | 表示速度・モバイル性能が低い | SEO | SEO | mobile_experience | 達成率<0.6 | 「スマホ・表示体験」の定義そのもの | — | true(暫定マッピング) |
| seo-duplicate-canonical | 重複URL・canonical不備 | SEO | SEO | site_structure | 達成率<0.6 | 重複URL・canonicalもページ設定(サイト構造)の一部とみなした(rootCauseKey共有: SEO:site_structure) | — | true(暫定マッピング) |
| seo-measurement-incomplete | 計測環境が不完全 | SEO | SEO | search_performance | 達成率<0.6 | 検索での実績を計測する仕組みという意味で「検索での表示・流入実績」に紐付けた(やや間接的な対応) | — | true(暫定マッピング) |

## 5. Web・予約導線(正本§6、10項目)

| improvement key | improvement label | displayDomain | evidenceDomain | diagnosticAnchor(criterionKey) | 発火条件 | なぜそのcriterionに紐付けたか | escalation対象か | provisional |
|---|---|---|---|---|---|---|---|---|
| booking-link-broken | 予約リンク切れ・遷移先誤り | WEB_BOOKING | WEB_BOOKING | booking_funnel_flow | 達成率<0.34 | 予約導線が機能しない根本原因として「予約・問い合わせ導線」に紐付けた | ○(booking_failure) | true(暫定マッピング) |
| booking-phone-invalid | 電話番号が誤り・タップ不可 | WEB_BOOKING | WEB_BOOKING | booking_funnel_flow | 達成率<0.34 | 電話導線も予約・問い合わせ導線の一種とみなした(rootCauseKey共有: WEB_BOOKING:booking_funnel_flow) | ○(booking_failure) | true(暫定マッピング) |
| booking-form-error | フォーム送信エラー | WEB_BOOKING | WEB_BOOKING | form_usability | 達成率<0.34 | フォームの機能不全は「予約フォームの使いやすさ」の完全な欠如として扱った | ○(booking_failure) | true(暫定マッピング) |
| booking-no-cv-measurement | CV計測がない | WEB_BOOKING | WEB_BOOKING | measurement_setup | 達成率<0.34 | 「計測・改善環境」の定義そのもの | ○(booking_failure) | true(暫定マッピング) |
| booking-cta-hard-to-find | 予約CTAが見つけにくい | WEB_BOOKING | WEB_BOOKING | purpose_match | 達成率<0.6 | CTAの見つけやすさは来院目的との一致(動線設計)に関連すると判断 | — | true(暫定マッピング) |
| booking-too-many-steps | 予約までの階層が長い | WEB_BOOKING | WEB_BOOKING | booking_funnel_flow | 達成率<0.6 | 予約までの階層の長さも予約導線設計の一部とみなした(rootCauseKey共有: WEB_BOOKING:booking_funnel_flow) | — | true(暫定マッピング) |
| booking-too-many-fields | 入力項目が多い | WEB_BOOKING | WEB_BOOKING | form_usability | 達成率<0.6 | フォーム項目数はフォームの使いやすさの一部とみなした(rootCauseKey共有: WEB_BOOKING:form_usability) | — | true(暫定マッピング) |
| booking-no-auto-reply | 自動返信がない | WEB_BOOKING | WEB_BOOKING | pre_booking_reassurance | 達成率<0.6 | 自動返信の有無を「予約前の不安解消」の一種として扱った | — | true(暫定マッピング) |
| booking-info-insufficient | 料金・アクセス・持ち物が不足 | WEB_BOOKING | WEB_BOOKING | pre_booking_reassurance | 達成率<0.6 | 料金・アクセス情報の充実も不安解消の定義そのものとみなした(rootCauseKey共有: WEB_BOOKING:pre_booking_reassurance) | — | true(暫定マッピング) |
| booking-popup-interferes | ポップアップが操作を妨害 | WEB_BOOKING | WEB_BOOKING | form_usability | 達成率<0.6 | ポップアップによる操作妨害もフォーム利用のしやすさの一種とみなした(rootCauseKey共有: WEB_BOOKING:form_usability) | — | true(暫定マッピング) |

## 6. 口コミ・信頼性(正本§7、8項目)

| improvement key | improvement label | displayDomain | evidenceDomain | diagnosticAnchor(criterionKey) | 発火条件 | なぜそのcriterionに紐付けたか | escalation対象か | provisional |
|---|---|---|---|---|---|---|---|---|
| reviews-recent-scarce | 直近90日の口コミが少ない | REVIEWS | REVIEWS | review_freshness | 達成率<0.6 | 「口コミの鮮度」の定義そのもの | — | true(暫定マッピング) |
| reviews-no-response | 口コミへの返信がない | REVIEWS | REVIEWS | response_quality | 達成率<0.6 | 「返信・患者対応」の欠如そのもの | — | true(暫定マッピング) |
| reviews-negative-neglected | 低評価口コミが放置 | REVIEWS | REVIEWS | response_quality | 達成率<0.6 | 低評価への未対応も返信品質の一種とみなした(rootCauseKey共有: REVIEWS:response_quality) | — | true(暫定マッピング) |
| reviews-response-contains-pii | 返信に個人情報を含む | REVIEWS | REVIEWS | policy_risk | 達成率<0.34 | 個人情報を含む返信は「ポリシー・法令リスク」に該当すると判断 | ○(legal_medical_ad_privacy) | true(暫定マッピング) |
| reviews-recurring-complaints | 同じ不満が複数発生 | REVIEWS | REVIEWS | review_health | 達成率<0.6 | 同じ不満の繰り返しを「口コミの健全性」の毀損とみなした | — | true(暫定マッピング) |
| reviews-trust-info-missing | 医師・料金・リスク情報が不足 | REVIEWS | REVIEWS | objective_trust_info | 達成率<0.6 | 「客観的な信頼情報」の定義そのもの | — | true(暫定マッピング) |
| reviews-exaggerated-claims | 誇大・根拠のない表現 | REVIEWS | REVIEWS | policy_risk | 達成率<0.34 | 誇大表現は医療広告ガイドライン上のリスクと判断(rootCauseKey共有: REVIEWS:policy_risk) | ○(legal_medical_ad_privacy) | true(暫定マッピング) |
| reviews-incentivized-reviews | 特典付き・選別型の口コミ依頼 | REVIEWS | REVIEWS | policy_risk | 達成率<0.34 | 口コミインセンティブも景品表示法・医療広告ガイドライン上のリスクとみなした(rootCauseKey共有: REVIEWS:policy_risk) | ○(legal_medical_ad_privacy) | true(暫定マッピング) |

---

## 7. まとめ

- 45項目すべての診断根拠(`diagnosticAnchor`)への紐付けは、正本に明記のない**全件「暫定マッピング」**(`provisional: true`)です。これは初版から変更していません。
- うち4件(aio-structured-data-missing / aio-update-date-unclear / aio-crawl-blocked / llmo-no-direct-answer)は`displayDomain`と`evidenceDomain`が異なる「cross-domain」項目です。これは不具合ではなく意図した構造として扱います(0.3節)。
- 13個の`rootCauseKey`が2〜3項目で共有されており(0.2節)、うち8グループはstandard種別の候補が2〜3件→1件へ`deduplicateByRootCause()`で集約されます。残り5グループは、共有側のstandard候補が1件のみ、またはescalation同士の共有のため、実質的な集約は発生しません。risk_escalationは常にこの重複整理の対象外です。
- `evidenceRequirements[]`により、必要なcriterionが測定できていない場合はその候補を生成しません(推測での独立シグナルの捏造はしません、0.4節)。
- 発火条件(達成率閾値0.34 / 0.6)自体は実データに基づく調整前の暫定値であり、初版から変更していません。

このレビュー内容についてご確認・ご指摘があれば反映します。医療広告AIチェック等の次実装には、ご指示があるまで着手しません。
