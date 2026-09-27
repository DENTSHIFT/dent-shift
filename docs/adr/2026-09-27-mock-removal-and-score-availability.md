# ADR: 通常診断からのMock除去とスコア算定方針(2026-09-27)

## ステータス
承認済み(PO承認、2026-09-27)

## 背景
本番・test環境の通常の無料診断において、`MockAiProvider`(疑似乱数によるChatGPT/Gemini
言及シミュレーション)が、正式スコア(AIOドメインの一部criterion)・患者質問ごとの
勝敗判定・「なぜ表示されなかったか」の原因分析・根拠文言(evidence)へ混入していた。
また、この混入は「サンプル診断」バナーで警告されていたものの、警告文が弱く、
LP・FAQ・プラン比較表には「ChatGPT・Gemini・Google AIを実測している」
「対象AI 5種」「競合医院20院」等、実装と一致しない断定的な表現が残っていた。

## 決定事項

1. **2026-09-08承認の「canonical/score分離」を維持する。** canonical(実測、
   `aiMeasurementProvider`経由のOpenAI等)の観測結果は、既存のAIOスコア算出へ接続しない
   (`tests/unit/runFreeDiagnosisCanonicalScoringIsolation.test.ts`が保証する契約を
   今回も変更しない)。
2. **2026-09-27以降、通常診断ではMockAiProviderを使用しない。** `/api/diagnosis`の
   composition rootは`UnavailableAiProvider`(常に空配列を返す)を使う。
   `MockAiProvider`自体は削除せず、ユニットテスト・fixture・将来の明示的なデモモード
   専用として残す。
3. **正式なスコア算定方法が承認されるまで、集計点(AIO総合点・6領域スコア・100点満点の
   総合スコア)を算出しない。** 実測データ接続が無い間、6領域すべてが`unavailable`(未測定)
   になり、`scoreBreakdown.totalStatus`は常に`"unavailable"`になる。UIは`0/100`等の
   数値・ゲージを一切表示せず、「現在、算定可能な実測データが不足しています」と表示する。
4. **canonical実測は、観測事実として別枠表示する。** 患者質問ごとに「AIで表示された/
   もう一歩/表示されなかった/データ不足」という事実ベースの表現のみを用い、点数化・
   順位付け・競合優劣の断定は行わない。
5. **将来スコアへ接続する場合は、別途のPO承認と算定方法の検証が必要。** 本ADRは
   その検証・承認を代替しない。

## 影響を受けたコード
- `src/server/providers/ai/unavailableAiProvider.ts`(新規)
- `src/app/api/diagnosis/route.ts`(`aiProvider`の差し替え)
- `src/server/providers/scoring/unavailableScoreProvider.ts`(観測0件時のAIO扱い、
  `dataSource`タグの是正)
- `src/app/diagnosis/result/[id]/resultViewModel.ts`(`OverallScoreViewModel.totalStatus`
  追加、サンプル診断バナー文言強化)
- `src/app/diagnosis/result/[id]/page.tsx` / `src/app/dashboard/page.tsx`(全未測定時の
  専用表示)
- `src/domain/billing/planCatalog.ts`(プラン比較表・カード見出しから未実装機能を削除)
- `src/app/page.tsx` / `src/app/diagnosis/page.tsx`(LP・FAQ・診断フォームの文言是正)

## 保証(回帰テスト)
- `tests/unit/mockExcludedFromProductionDiagnosis.test.ts`: 通常診断にMockが混入しない、
  未測定を0点にしない、根拠のない改善案を生成しない
- `tests/unit/runFreeDiagnosisCanonicalScoringIsolation.test.ts`(既存、変更なし):
  canonical実測がスコアへ流入しない
- `tests/unit/planCatalog.test.ts`: プラン比較表に未実装機能が含まれない

## 今後の課題(別タスク、本ADRの範囲外)
2026-09-08になぜcanonical/score分離が決定されたか、また将来canonicalデータから正確な
スコアを作るために必要な条件(算定方法・部分測定時の扱い・法務表現)は、別途調査する。
