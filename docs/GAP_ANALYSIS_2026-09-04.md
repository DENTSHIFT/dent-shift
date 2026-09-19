# DENT SHIFT — GAP分析(現在の仮実装 vs 正本仕様)
作成日: 2026-09-04
対象: repo `~/Documents/dent-shift` 時点のコード(git: `afbbfdb` Step3, `ddb6fa6` Step4)
このドキュメントはコード変更を含みません。分析結果の提示のみです。

## 前置き: リポジトリの状態について

正本資料の配置作業と並行して、このリポジトリには git履歴があり、`ddb6fa6 Step4: email/password auth + free-member dashboard` というコミットが既に存在します。これは私(Claude, このセッション)が作成したものではありません。認証まわりの実装自体は質が高く、`SECURITY.md`の方針(電話番号不要・clinic_idベースのテナント分離)にも沿っていますが、`DENT_SHIFT_CLAUDE_HANDOFF.md`が定める「ユーザー確認を得てから実装する」という手順を経ずに追加されています。以下のA〜Jは、このStep4実装も含めた**現状のコード全体**を対象に評価しています。

---

## A. そのまま活かせる実装

- **6領域必須チェック・取得不能値の非0扱いという骨格**(`src/domain/diagnosis/scoring.ts`): 「APIエラー・取得不能を0として扱わない」(根拠: `DENT_SHIFT_AI集患総合スコア診断ロジック_Ver1.pdf` §14、`docs/DENT_SHIFT_CLAUDE_HANDOFF.md`禁止事項)という原則を型・関数レベルで強制する設計自体は正本と整合。中身(配点根拠・領域順序)はB参照。
- **認証基盤**(`src/server/auth/{session,password,requireContact}.ts`, `src/app/api/auth/*`): メール+パスワード、電話番号を一切要求しない設計は、`機能要件定義書 §5.3`「電話番号方針」と一致。session cookieのhttpOnly化、scryptによるパスワードハッシュ、タイミング攻撃対策も適切。
- **テナント分離方針**(`diagnosisRepository.getDiagnosesByClinicId`): clinic_idスコープでのみ取得する設計は`SECURITY.md`の方針と一致。
- **患者個人情報を持たないモデル設計**: `Clinic`/`Contact`/`Session`/`Diagnosis`のどこにも患者氏名・電話・病歴等のフィールドがない。絶対ルール(`PRODUCT_SPEC.md §2-3`, `機能要件定義書 §21`)と一致。
- **provider interfaceの骨格**(`server/providers/ai`, `server/providers/competitor`): 「provider interfaceを作りmock/sandbox/actualを差し替え可能にする」方針(`完全引き継ぎマスターVer2 §15`)と一致。interface自体は活かせる。
- **「取得不能」「(推定)」を明示するUIの考え方**: 「0とデータなしを混同しない」方針と一致。見た目(デザイン)は未反映(→E)。

## B. 修正が必要な実装

- **領域の表示順序**: 現在の`DOMAIN_ORDER`は `AIO,MEO,SEO,LLMO,WEB_BOOKING,REVIEWS`。正本のダッシュボード表示順は `AIO→LLMO→MEO→SEO→予約導線→口コミ`(根拠: `診断ロジック仕様書 §11`)。
- **サブ項目・配点根拠が皆無**: 正本は各領域に5つの判定項目と配点を持つ(AIO: 医院表示10/引用6/推薦順位5/正確性5/質問領域4、LLMO: 3/3/4/3/2、MEO: 3/4/6/3/4、SEO: 3/3/4/3/2、Web予約: 2/2/3/1/2、口コミ: 3/2/2/2/1)。現在の実装(`runFreeDiagnosis.buildScoreBreakdown`)は領域ごとに乱数で合計点を1発生成しているだけで、判定根拠がない(根拠: `診断ロジック仕様書 §4〜9`)。
- **改善TOP3の優先度算出式**: 正本は「集患インパクト/緊急性/実行容易性/波及効果」の4軸×5点=20点満点、16-20最優先/11-15優先/6-10通常/0-5経過観察という明確な採点式と、重大リスク(予約障害・情報不一致・計測障害・法務規約リスク・クロール障害)の自動エスカレーション(スコア計算を待たずTOP表示)を持つ。現在の`buildTopImprovements`はimpact/confidence/urgencyのhigh/medium/lowを掛け算するだけの簡易ヒューリスティック(根拠: `AI改善アクション生成ロジック_Ver1.pdf §1.2, §8`)。
- **改善アクションの検出カタログが未実装**: 正本は領域ごとに「検出内容→生成アクション→優先度→推奨担当」の具体的対応表を持つ(AIO7項目・LLMO6項目・MEO7項目・SEO7項目・Web予約導線10項目・口コミ8項目、計45項目)。現在は「達成率50%未満なら汎用の改善案を1件生成」という単純条件のみ(根拠: 同PDF §2〜7)。
- **無料診断の質問数**: 正本は「代表5質問」。現在は6問固定(根拠: `診断ロジック仕様書 §4.3`)。
- **患者質問の内容が医院に依存しない**: 正本のAIO標準質問設計(§4.1)は地域名・駅名など医院固有情報でパラメータ化されている。現在はハードコードされた汎用6問で、医院の所在地情報を使っていない。

## C. 破棄候補の仮実装

丸ごと破棄すべき実装はありません。provider interfaceを含む全体構造は「差し替え可能」を前提に作られているため、Bの修正はいずれも**中身の置き換え**で対応可能です。強いて言えば、`buildScoreBreakdown`内の「領域ごとに乱数で合計点を生成する」部分は、サブ項目ベースの計算に置き換える前提で実質的に破棄されます。

## D. 未実装のP0

正本の優先度表(`機能要件定義書 §4.1`)でP0確定なのに未着手のもの:

- **医療広告AIチェック**(P0確定, §4表・§13): 未着手
- **アンバサダー専用アカウント・紹介コード計測**(P0確定, §4表・§17.4): 未着手
- **医院別プロンプト自動生成**(P0確定, §4表・§6): 現状は固定質問文のみ
- **プラン比較・オンライン契約・決済**(Step5, `P0_ACCEPTANCE.md`): 未着手
- **Google連携基盤(GA4/Search Console, P0範囲)**(`GOOGLE_INTEGRATION_SPEC.md §11`): 未着手
- **「営業電話はありません」等の明記**(`機能要件定義書 §5.3`): LP/診断フォームに未反映

## E. UI/デザインの差分

- 現在のUI(`page.tsx`, `diagnosis/page.tsx`, `diagnosis/result/[id]/page.tsx`, `dashboard/page.tsx`)は最小限のインラインstyleで作った仮UIで、`design/reference/dashboard/`・`design/reference/lp/`の実画像、`public/brand/logo/`の正式ロゴを一切反映していません。`DASHBOARD_UI_SPEC.md`は「最重要ルール: 既存画像を無視してゼロから別デザインを作らない」と明記しており、現状はこの正本と未照合の状態です。
- ダッシュボードのカード構成(TOP: 医院名/総合スコア/前回比/商圏順位/AIで選ばれている割合/今月の優先改善/相談CTA、メインカード1〜5)が`DASHBOARD_UI_SPEC.md`に詳細定義されていますが、現在の`dashboard/page.tsx`は診断履歴一覧のみでこの構成を反映していません。
- サイドナビ(経営サマリー/AI検索/AI回答履歴/競合医院/SEO/MEO/口コミ/広告/予約導線/改善アクション/レポート/Academy/スペシャリスト相談/設定連携)も未実装。
- `public/brand/logo/`のロゴファイルをコード側で一度も参照していません。

## F. Google連携の差分

完全に未着手です。`GOOGLE_INTEGRATION_SPEC.md`が定義するOAuth基盤、`integration_connections`/`integration_resources`テーブル、GA4/Search Console接続、`connection_status`(not_connected/connected/needs_reauth等)は`prisma/schema.prisma`に一切存在しません。

## G. DB/認証/テナント分離の差分

- 認証(`Contact`/`Session`)はStep4で実装済みで、電話番号不要方針とも整合(良い)。
- ただし`Contact.role`が文字列のみの単純設計で、`DATA_MODEL.md`が見据えていた複数医院横断ロール(AGENCYが複数clinicを管理する等)には対応していません。P0では許容範囲ですが、将来的な見直しが必要です。
- **audit_logsテーブルが未実装**。`SECURITY.md`/`機能要件定義書 §21`が「医院単位の権限管理と監査ログを備える」を非機能要件として明記していますが、`prisma/schema.prisma`に該当モデルがありません。
- integration_connections等のGoogle連携テーブルも未実装(Fと重複)。

## H. セキュリティ上の問題

重大な脆弱性はありませんが、以下が未対応です。

- **rate limitなし**: `/api/auth/login`等へのブルートフォース対策が未実装(`実装品質ルール`が要求)。
- **CSRF対策が明示実装されていない**: Next.jsのSame-Origin Cookieに依存している状態。
- **監査ログ未実装**(Gと同じ指摘)。
- **`.env.example`にGoogle連携用キー名が未追加**(`GOOGLE_INTEGRATION_SPEC.md §7`: `GOOGLE_CLIENT_ID`等)。

## I. 2026-10-01 MVPまでの修正優先順位(提案)

1. 6領域スコアをサブ項目・配点通りに実装し直す(Bの核心。ダッシュボード・改善提案すべての土台)
2. 改善アクション生成ロジックを正本の4軸20点式+自動エスカレーション規則に置き換える
3. 医療広告AIチェック(P0確定機能)を実装する
4. ダッシュボードUIを正本画像(`design/reference/dashboard/`)に沿って作り直す
5. アンバサダー・紹介コード計測(P0確定機能)を実装する
6. Google連携基盤(OAuth+GA4+Search Console、P0範囲のみ)を実装する
7. 決済・プラン比較(Step5)を実装する
8. 監査ログ・rate limit等のセキュリティ強化を行う

## J. 最初に直すべき最小単位

`scoring.ts` / `runFreeDiagnosis.ts`のスコア生成ロジックを、正本のサブ項目配点表(AIO/LLMO/MEO/SEO/Web予約/口コミ、計30項目)に置き換えることが最小かつ最も影響範囲の大きい着手点です。ダッシュボード・改善提案・P0受入条件のすべてがこのスコアに依存しているため、ここが土台になります。

---

以上がGAP分析です。コード変更はまだ行っていません。優先順位(I)・最小着手単位(J)についてご確認いただき、着手してよい範囲を教えてください。
