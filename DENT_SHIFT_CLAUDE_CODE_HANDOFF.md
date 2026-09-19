# DENT SHIFT → Claude Code 開発引き継ぎ書 完成版
**作成日:** 2026-09-03  
**対象:** Claude Code / DENT SHIFT 開発  
**プロダクト:** DENT SHIFT（歯科医院専用AI集患OS）  
**リリース目標:** 2026-10-01 MVP  
**機密区分:** Confidential  
**文書の役割:** Claude Codeが既存プロジェクトを読み込み、仕様を壊さず、P0から実装を進めるためのマスター引き継ぎ書
---
# 0. Claude Codeに最初に渡すマスタープロンプト
以下をClaude Codeへ最初に渡すこと。
```text
あなたはDENT SHIFTのリードエンジニア兼プロダクト実装責任者です。
DENT SHIFTは「歯科医院専用AI集患OS」です。
単なるSEOツール、AIO/LLMO分析ツール、広告運用ツールではありません。
医院名またはURLを入口として、
AI検索・SEO・MEO・口コミ・Web予約導線・広告等を横断分析し、
1. AIに医院情報が正しく認識されているか
2. 患者が実際に使う質問で競合医院に勝っているか
3. なぜ負けているのか
4. 次に何を改善すべきか
5. 改善後にAI露出・流入・予約・新患がどう変わったか
までを一気通貫で可視化・改善するプロダクトです。
最重要方針は以下です。
- 歯科医院専用であること
- 院長が専門知識なしで使えること
- 営業電話なし・オンライン完結で契約できること
- 「分析」ではなく「改善行動」と「予約・新患成果」につなげること
- 患者個人情報を原則取得・保存しないこと
- 医療広告・個人情報・外部サービス規約を守ること
- 外部公開・広告変更・医院情報変更などは、人の明示承認なしに自動実行しないこと
- APIエラー・取得不能値を0として扱わないこと
- 架空データを実データとして表示しないこと
- AI生成担当者を実在人物と誤認させないこと
- P0/P1/P2を勝手に入れ替えないこと
- MVPを肥大化させず、2026-10-01のP0リリースを最優先すること
この引き継ぎ書を開発仕様の入口とし、
既存リポジトリがある場合は、まず全体構造・README・package設定・env例・DB・API・画面・既存実装を確認してください。
既存実装を確認せずに全面リライトしないでください。
既存コードと本仕様に不一致がある場合は、
「既存仕様」「本引き継ぎ書」「変更提案」を明示してから修正してください。
まず最初に以下を行ってください。
1. リポジトリ構造を確認
2. 現在実装済みの機能を一覧化
3. 未実装・部分実装・仕様不一致を分類
4. P0実装に必要な依存関係を整理
5. IMPLEMENTATION_PLAN.md を作成
6. P0を小さな実装単位へ分解
7. 最初の実装タスクから順番に着手
8. 各タスク終了時にテストと変更内容を記録
不明点があっても開発を止めず、
確定していない事項は「仮実装」「設定値」「TODO」に分離し、
後から差し替えられる構造で進めてください。
ただし、料金、契約条件、医療情報、患者個人情報、安全要件を推測で確定しないでください。
```
---
# 1. DENT SHIFTとは
## 1.1 プロダクト定義
DENT SHIFTは、**歯科医院専用のAI集患OS**。
汎用AIO/LLMOツールのように、
「AIに掲載された」「引用された」「順位が何位だった」
だけを見せて終わるものではない。
DENT SHIFTは、
**AIに選ばれる → 医院サイトへ来る → 診療ページを見る → 予約する → 新患になる**
までを一続きの成果として扱う。
### 中心価値
> 現状が分かる。  
> 競合との差が分かる。  
> 次に何をすればよいか分かる。  
> 予約につながったかまで分かる。
### ブランドタグライン
> 歯科集患を、AIでシフトする。
---
# 2. 最新仕様の優先順位
Claude Codeが仕様矛盾を見つけた場合は、以下の順に優先する。
## 優先度1：最新競合反映仕様
**Ver.3.5 AKARUMI競合ベンチマーク反映（2026-09-02）**
最重要追加要素：
- AIクローラー健康診断
- 患者質問需要スコア
- DENT SHIFT改善ボード
- AI回答履歴の歯科専用タグ
- 院長用PDF / 制作会社向け指示書 / CSV等の出力
- AI流入 → 予約 → 新患 → 推定売上への成果接続
## 優先度2：Ver.3.4
ChatGPT広告・代理店型競合反映。
重要ルール：
- DENT SHIFTは広告代理店にならない
- 自然AI推薦とAI広告を混同しない
- P0ではAI広告運用機能を作らない
- P1で広告計測・分析
- P2でスペシャリスト/提携代理店への接続
## 優先度3：Ver.3.3
LLMOA / FORTIS競合反映。
重要要素：
- AI回答履歴
- 引用元分析
- 対応AIの段階追加
- 成果ストーリー
- 実測値以外を実績として表示しない
- 歯科特化と予約・新患成果で差別化
## 優先度4：Ver.3.2
API・MCPハイブリッド連携基盤。
## 優先度5：Ver.3.1 / Ver.3.0
基本機能、UI、競合インテリジェンス、診断ロジック、P0/P1/P2の土台。
## CRM仕様
CRM領域は **DENT SHIFT_CRM_システム設計図_Ver1** を基準とする。
---
# 3. 絶対に変えてはいけない事業ルール
1. DENT SHIFTは**歯科医院専用**。
2. 顧客管理の主単位は「人」ではなく**歯科医院**。
3. 医院IDを軸に診断・契約・改善・相談・連携・決済を一元化する。
4. 無料診断から契約まで、原則**電話番号なし**で進める。
5. **営業電話を前提にしない**。
6. 商談を必須にしない。
7. 必要な人だけスペシャリスト相談へ進む。
8. 患者氏名・電話番号・病歴・相談本文などの患者個人情報は原則保存しない。
9. 医療情報をAIが無確認で公開しない。
10. 広告・GBP・医院サイト等の外部更新は明示承認なしに行わない。
11. データ取得失敗を0として処理しない。
12. 推定値は「推定」、サンプルは「サンプル」と表示する。
13. 因果関係を証明できない結果を「この施策で増えた」と断定しない。
14. 対応AI、料金、API仕様など変更される情報をコードに過剰固定しない。
15. 料金・プランは管理可能な設定値とし、ハードコードしない。
16. AI生成人物は必ず「AI生成モデル」と表示する。
---
# 4. ユーザー体験の核
## 4.1 無料診断導線
基本導線：
```text
Instagram広告 / Google広告 / SNS / 自然流入
    ↓
LP
    ↓
医院名・URL入力
    ↓
約60秒 AI集患診断
    ↓
AIで選ばれている割合
    ↓
患者質問別の競合勝敗
    ↓
なぜ競合に負けているか
    ↓
改善TOP3〜5
    ↓
詳細レポート
    ↓
プラン比較
    ↓
オンライン契約
    ↓
オンボーディング
    ↓
継続診断
```
CTA周辺の固定メッセージ：
- 営業電話なし
- 約60秒
- クレジットカード不要
- まず結果だけ確認
## 4.2 LP主要コピー
### 本命
> その患者、AIは競合医院をすすめていませんか？
### サブ
> どこで負けているか。  
> なぜ負けているか。  
> 次に何をすべきか。  
> URLひとつでAIが分析。
### CTA
> 無料でAI集患診断する
---
# 5. P0 / MVP
**リリース目標：2026-10-01**
MVPで重要なのは「全部作る」ことではなく、
無料診断から契約、初期利用までのコア体験を成立させること。
---
# 6. P0機能一覧
## 6.1 無料60秒AI集患診断
入力：
- 医院名
- 公式サイトURL
- メールアドレス
任意または契約後：
- GBP
- 予約URL
- 診療科目
- 強化したい自費診療
- 商圏
- 最寄駅
- 診療時間
- 院長名
- 比較競合
- 目標予約・新患
無料診断結果：
- 6領域100点
- ChatGPT / Geminiの主要計測
- AI推薦シェア
- 質問別競合勝敗
- 競合3院比較
- 敗因
- 改善TOP3
- 医療広告リスク
- 取得日時 / 測定条件
---
# 7. 6領域100点診断
| 領域 | 配点 |
|---|---:|
| AIO | 30 |
| MEO | 20 |
| SEO | 15 |
| LLMO | 15 |
| Web・予約導線 | 10 |
| 口コミ・信頼性 | 10 |
重要：
- 総合スコアと予約数、新患数などの成果KPIを混同しない。
- 取得不能項目は0点ではなく「取得不能」。
- 各スコアに根拠データを持たせる。
---
# 8. AI競合インテリジェンス
## 8.1 AIで選ばれている割合
内部用語：Share of Voice / SoV
院長向け表示：
> AIで選ばれている割合
持つ情報：
- 自院
- 競合
- AI別
- 診療科目別
- 商圏別
- 期間別
- 前期間差
注意：
SoVは新患数そのものではない。
---
## 8.2 患者質問別の勝敗
ステータス：
- 勝ち
- 拮抗
- 負け
- データ不足
判定材料：
- 推薦順位
- 言及
- 引用
- 回答量
- 情報正確性
- 再現性
---
## 8.3 敗因分析
候補：
- 症例不足
- FAQ不足
- 料金情報不足
- 院長プロフィール不足
- 専門資格・所属学会情報
- 口コミ数
- 口コミ鮮度
- 第三者媒体での言及不足
- 診療ページ不足
- title / heading / 構造化データ
- GBP情報差
- AIによる医院情報誤認
- クロール障害
表示は、
- 有力要因
- 可能性あり
- データ不足
など確度を伴わせる。
「原因です」と断定しない。
---
# 9. 患者質問需要スコア
0〜100。
構成：
- 検索・質問需要：30
- 予約意図：25
- 診療単価・医院戦略適合：15
- 商圏適合：15
- 競合差・改善余地：15
十分な実データがない場合：
> 推定スコア
と明記。
患者質問生成軸：
### 診療別
- インプラント
- 矯正
- 審美
- ホワイトニング
- 小児
- 予防
- 一般歯科
### 意図別
- おすすめ
- 比較
- 料金
- 痛み
- 評判
- 医師
- 症例
- 駅近
- 土日
- 夜間
- 緊急
### 検討段階
- 認知
- 情報収集
- 比較
- 医院選び
- 予約直前
### 地域
- 都道府県
- 市区町村
- 駅
- 生活圏
---
# 10. AIクローラー健康診断
監視候補：
- GPTBot
- OAI-SearchBot
- PerplexityBot
- Google-Extended
- ClaudeBot等
計測：
- 最終巡回
- 巡回回数
- HTTPステータス
- robots.txt
- meta robots
- X-Robots-Tag
- XML sitemap
- 重要ページのカバー率
- 前期間比較
重要ページ分類：
- TOP
- 医院紹介
- 院長/医師
- アクセス
- 料金
- 症例
- FAQ
- 各診療メニュー
院長表示：
- AIが確認できています
- 注意
- 要改善
- 未判定
禁止：
> クロールされた = AI回答に必ず掲載される
という誤解を生む表示。
---
# 11. AI回答履歴
保存軸：
- clinic_id
- patient_question
- ai_provider
- model
- response
- mention
- recommendation_rank
- citations
- competitor_mentions
- region
- measurement_condition
- captured_at
- evidence
- previous_diff
差分：
- 新規掲載
- 順位上昇
- 順位低下
- 掲載消失
歯科専用タグ：
- 診療
- 患者意図
- 検討段階
- 地域
- AI
- 勝敗
- 自院引用
- 競合引用
- 正確
- 不正確
- 要確認
---
# 12. DENT SHIFT改善ボード
状態遷移：
```text
検出
→ 提案
→ 承認
→ 未着手
→ 対応中
→ 確認待ち
→ 完了
→ 再計測
→ 効果確認
```
タスク項目：
- task_id
- clinic_id
- title
- domain
- target_url
- treatment_category
- patient_question
- evidence
- impact
- confidence
- urgency
- priority
- assignee_type
- due_at
- status
- execution_note
- evidence_after
- baseline
- remeasure_at
- result
- compliance_check
- approved_by
主画面ではTOP3を優先。
---
# 13. 改善アクション生成
各改善案に必ず含める：
1. 検出された事実
2. 患者・集患への影響
3. 放置リスク
4. 修正手順
5. 文案または実装例
6. 担当
7. 想定工数
8. 優先度
9. 根拠
10. 影響KPI
11. 医療広告チェック
12. 完了条件
13. 再診断日
優先度軸：
- 集患インパクト
- 緊急性
- 実行容易性
- 波及効果
以下は強制的に最優先：
- 予約障害
- 重大な医院情報不一致
- 法令リスク
- 個人情報リスク
- クロール障害
---
# 14. 成果ファネル
```text
AIに選ばれる
↓
AI経由サイト訪問
↓
診療ページ閲覧
↓
予約CTA
↓
フォーム開始
↓
予約完了
↓
新患
↓
保険 / 自費
↓
推定売上 / LTV
```
P0では取得可能範囲から開始する。
欠損値を補完しない。
成果を因果断定しない。
表示例：
> 施策実施後にAI経由予約が増加
は可。
> この施策で予約が増えた
は因果証明がない限り不可。
---
# 15. ダッシュボード
## 15.1 TOP画面
最優先：
- 総合集患スコア
- 前回比
- AIで選ばれている割合
- 競合との差
- 最優先改善TOP3
- 成果KPI
- スペシャリスト相談
## 15.2 主カード
1. AIで選ばれている割合
2. 患者質問ごとの勝ち負け
3. なぜ負けている？
4. 今月やるべきこと
5. AIから予約まで
## 15.3 主ナビ
- 経営サマリー
- AI検索
- AIの回答履歴
- 競合医院
- SEO
- MEO
- 口コミ
- 広告
- 予約導線
- 改善アクション
- レポート
- Academy
- スペシャリスト相談
- 設定・連携
## 15.4 UI原則
- 院長向けにAPI/MCP/OAuth等を主表示しない
- 専門用語より患者・予約への意味を優先
- 数字には取得日・条件
- 実際の根拠へ辿れる
- スマホでも主要確認・承認可能
- 最初の画面に情報を詰め込みすぎない
---
# 16. CRM
DENT SHIFT CRMはSalesforce/HubSpot中心ではなく**自社開発**。
> **2026-09-20更新(ユーザー承認済み方針変更)**: 「DENT SHIFT Claude実装指示書_認証・決済・Salesforce連携_2026-09-17」により、この方針は撤回された。DENT SHIFT DBを引き続きsource of truthとしたまま、Salesforceを顧客行動・リード・契約状態のCRM同期先として非同期・疎結合で利用する(`src/server/services/salesforceSync.ts`参照)。以下の自社開発CRM設計(16.1以降)はP1以降の検討事項として残すが、P0ではSalesforce同期を優先する。
## 16.1 二画面構成
### 医院向け
院長 / スタッフ / 制作会社
### 運営CRM
管理 / CS / 分析 / 経理
同一 clinic_id で同期する。
---
# 17. 顧客ステージ
```text
匿名訪問
→ 診断開始
→ 診断完了
→ 無料会員
→ プラン選択
→ 決済待ち
→ 契約中
→ 初期設定中
→ 利用中
→ 要支援
→ 解約予定
→ 解約済み
```
---
# 18. 主要DBモデル
最低限以下を想定する。
```text
clinics
contacts
diagnoses
competitors
ai_observations
improvement_tasks
subscriptions
payments
onboarding_steps
integrations
appointments
support_cases
activities
notifications
ambassadors
attributions
audit_logs
```
## clinics
主キーは clinic_id。
持つもの：
- 医院名
- URL
- 住所
- 商圏
- 診療科目
- 状態
## contacts
医院に紐づく担当者。
- 院長
- スタッフ
- 制作会社
## diagnoses
- clinic_id
- 診断種別
- score
- score_breakdown
- evidence
- measured_at
## competitors
- clinic_id
- competitor_clinic
- url
- distance
- comparison_condition
## ai_observations
- clinic_id
- question
- AI
- model
- rank
- mention
- citation
- evidence
- captured_at
## improvement_tasks
改善ボード仕様に準拠。
## subscriptions
- clinic_id
- plan_id
- status
- started_at
- renew_at
- cancel_at
## integrations
- clinic_id
- provider
- status
- last_synced_at
- needs_reauth
- error_code
## audit_logs
重要操作を必ず残す。
---
# 19. 保存禁止データ
原則保存しない：
- 患者氏名
- 患者電話番号
- 患者メール
- 病歴
- 診療記録
- 相談内容本文
- 予約フォーム入力本文
- カード番号
- パスワード平文
- 外部サービスアクセストークン平文
予約・新患は可能な限り集計値として保持。
---
# 20. 権限
想定ロール：
- SUPER_ADMIN
- OPERATIONS_ADMIN
- CS
- ANALYST
- FINANCE
- CLINIC_OWNER
- CLINIC_STAFF
- AGENCY
重要変更には再認証または確認を要求する。
---
# 21. API / MCP
## 基本方針
**基幹処理：通常API/Webhook**  
**AI横断分析：MCP**
### API / Webhookを優先
- 認証
- 契約
- 決済
- 請求
- プラン
- 権限
- テナント
- スコア保存
- KPI集計
### MCPを活用
- GA4分析
- Search Console
- 広告データ
- GBP
- 競合分析
- 改善施策生成
- レポート生成
- 承認付き通知
### 初期MCPツール候補
```text
get_clinic_analytics_summary
get_search_console_summary
get_ads_performance
get_gbp_performance
compare_competitors
generate_improvement_actions
create_monthly_report
send_approved_notification
```
## 安全
- MCPで患者個人情報を送らない
- clinic_idでテナント分離
- read/writeを分離
- 書き込みは人承認
- 全呼び出し監査
- tokenをモデルへ露出しない
- timeout/API制限を0にしない
---
# 22. 外部連携
## P0候補
- GA4
- Google Search Console
- CSV
- DENT SHIFT診断
- Stripe等の決済API/Webhook
## P1
- Google Business Profile
- Google広告
- Meta広告
- Slack
- Web予約システム
- Google Calendar
- Google Meet
- TimeRex
技術実装時は、最新API仕様と利用規約を必ず確認すること。
---
# 23. 決済
基本的にWebhook駆動。
状態例：
```text
trial/free
active
past_due
restricted
suspended
cancel_scheduled
cancelled
```
既存仕様：
- 決済失敗後すぐ解約しない
- 自動再請求
- 支払成功後は自動復旧
- メール・画面通知
- 督促電話をしない
決済サービス・細かい日数は設定値化する。
---
# 24. アンバサダー
P0対象。
必要：
- ambassador
- unique referral code
- referral URL
- attribution
- diagnosis
- contract
- first payment
- reward status
成果確定：
> 有料契約 + 初回入金完了
クリックだけで成果確定しない。
---
# 25. スペシャリスト相談
- ユーザーが希望した場合のみ
- TimeRex
- Google Meet
- Google Calendar
- 面談履歴
- 改善タスク連携
AI生成人物：
- 姓のみ
- 「AI生成モデル」必須
- 実際の対応主体はCSチーム
- AI人物本人が返答しているように見せない
---
# 26. 医療広告・安全
AIチェック対象：
- 最上級
- 比較優良
- 安全性断定
- 効果断定
- 根拠のない数字
- 費用不足
- 期間不足
- リスク不足
- 患者体験談
- ビフォーアフター
- 自費診療要件
- 口コミインセンティブ
- 個人情報を含む口コミ返信
DENT SHIFTは法律判断そのものを提供しない。
UI：
> AIによるリスクチェックです。最終判断は医院または専門家が行ってください。
---
# 27. 自動化の境界
## 自動化してよい
- 診断
- 診断完了通知
- 認証
- 決済通知
- オンボーディング
- 連携切れ通知
- 定期診断
- 改善案生成
- 面談リマインド
- 管理アラート
## 人の承認が必要
- 医院サイト公開
- 広告変更
- GBP変更
- 口コミ返信公開
- 医療情報公開
- 個別料金変更
- 返金
- 医院データ外部提供
---
# 28. P0受入条件
最低限、以下が通るまでMVP完成としない。
- [ ] 医院URLから無料診断開始
- [ ] 医院レコード作成
- [ ] 重複医院候補検出
- [ ] メールで結果受取
- [ ] 電話番号なし
- [ ] 6領域100点
- [ ] ChatGPT / Gemini計測
- [ ] 医院言及・引用・正確性
- [ ] 競合3院
- [ ] AI推薦シェア
- [ ] 質問別勝敗
- [ ] 敗因
- [ ] 改善TOP3
- [ ] 医療広告チェック
- [ ] 測定条件・取得日
- [ ] プラン比較
- [ ] オンライン契約
- [ ] 決済状態
- [ ] オンボーディング
- [ ] 希望者のみ相談予約
- [ ] アンバサダー紹介コード
- [ ] 紹介→診断→契約→初回入金追跡
- [ ] 権限
- [ ] 監査ログ
- [ ] 患者個人情報を保存しない
- [ ] 取得不能値を0表示しない
- [ ] サンプルを実績表示しない
---
# 29. P1
P0を壊さず追加する。
- Google AI Overviews
- Google AI Mode
- Perplexity
- AI回答履歴詳細
- 引用元分析
- GA4
- Search Console
- AI流入
- 予約ファネル
- ヒートマップ
- 予約CTA分析
- AI広告分析
- 自然AI流入とAI広告の分離
- 制作会社向け指示書
- レポート
- CSV
- Google Calendar
- Meet
- サポートケース
- 決済復旧フロー
---
# 30. P2
- 高度な因果推定
- A/Bテスト
- 勝率予測
- 改善インパクト予測
- 商圏ベンチマーク
- 解約予兆
- 自動CS優先順位
- 承認付き外部変更
- 電子カルテ/レセコン
- 広告運用接続
P2をP0へ持ち込まない。
---
# 31. 技術スタックについて
現時点で正式な技術スタックは確定仕様として固定しない。
Claude Codeは既存repoがある場合、その技術を最大限維持する。
新規構築または不足部分については、
- 実装速度
- 保守性
- 型安全性
- 認証
- テナント分離
- DB migration
- Webhook
- API
- テスト
- Vercel/Cloud等へのデプロイ容易性
- 日本語UI
- セキュリティ
を基準に提案する。
ただし、提案をせず勝手に大規模置換しない。
---
# 32. 実装品質ルール
## TypeScript等を使う場合
- any乱用禁止
- domain型を明示
- env schema validation
- provider固有データをdomain層へ直接漏らさない
## DB
- migration必須
- clinic_idを中心にtenant isolation
- timestamps
- soft deleteが必要なものを明確化
- audit log
## API
- idempotency
- auth
- authorization
- validation
- structured error
- rate limit
- retry方針
- timeout
- provider failure
## UI
必ず以下を分ける：
```text
loading
success
empty
not_configured
needs_reauth
temporarily_unavailable
insufficient_data
error
```
`0`と`データなし`を混同しない。
---
# 33. テスト
最低限：
- unit
- API integration
- DB
- auth
- clinic isolation
- webhook idempotency
- permission
- diagnosis
- score
- missing data
- improvement task
- payment
- referral attribution
E2E重要シナリオ：
```text
LP
→ URL入力
→ 診断
→ メール認証
→ 結果
→ プラン
→ 決済
→ オンボーディング
→ ダッシュボード
```
および：
```text
紹介URL
→ 診断
→ 契約
→ 初回決済
→ ambassador成果確定
```
---
# 34. Claude Codeの作業ルール
各作業の開始前：
1. 変更対象ファイル確認
2. 仕様確認
3. 影響範囲
4. 最小変更案
各作業後：
1. lint
2. typecheck
3. test
4. build
5. migration確認
6. env追加確認
7. README / docs更新
8. 変更サマリー
---
# 35. 禁止事項
Claude Codeは以下をしない。
- 全面リライトを勝手に行う
- P0を膨らませる
- サンプル数値を実績として扱う
- 患者個人情報を収集する
- APIエラーを0表示
- 不明値を推定で補完
- 医療効果を保証
- AI表示順位を保証
- 外部変更を無承認で実行
- 料金をコード固定
- 営業電話を前提にCRM設計
- ~~Salesforce/HubSpot依存へ勝手に変更~~ (2026-09-20更新: ユーザー承認済みでSalesforce CRM同期を導入済み。16章参照)
- 歯科特化を外して汎用SaaS化
- AI人物を実在社員と表示
- 競合コンテンツをコピー
- 利用規約違反となるスクレイピング
---
# 36. 未確定事項
これらはClaude Codeが勝手に確定しない。
- 最終技術スタック
- 本番クラウド
- 決済代行の最終確定
- メール基盤
- プラン別正確な監視回数
- データ保持期間
- ユーザー数/権限数
- 返金/日割り
- Web予約システム対応順
- 本番AI計測方式
- 各AI providerの取得方式
- API原価
- 有人サポート詳細SLA
コード上はconfiguration / provider adapter / feature flagで差し替えやすくする。
---
# 37. 最初にClaude Codeが作るファイル
既存repoを確認した後、必要に応じて以下を作る。
```text
docs/
  PRODUCT_SPEC.md
  IMPLEMENTATION_PLAN.md
  ARCHITECTURE.md
  DATA_MODEL.md
  SECURITY.md
  P0_ACCEPTANCE.md
```
可能ならこの引き継ぎ書を：
```text
docs/DENT_SHIFT_CLAUDE_CODE_HANDOFF.md
```
としてrepoへ保存。
---
# 38. 最初の実装順
## Step 1
リポジトリ棚卸し。
出力：
```text
IMPLEMENTED
PARTIAL
MISSING
CONFLICT
```
## Step 2
P0アーキテクチャ確定。
- clinic
- auth
- diagnosis
- competitors
- AI observations
- improvement tasks
- subscription
- payments
- attribution
- audit
## Step 3
無料診断vertical slice。
```text
URL入力
→ clinic作成
→ diagnosis作成
→ mock/provider interface経由で分析
→ 6領域score
→ competitor result
→ improvement TOP3
→ UI
```
最初から外部APIを全て接続しない。
provider interfaceを作り、
mock / sandbox / actual providerを差し替え可能にする。
## Step 4
認証 / 無料会員。
## Step 5
プラン / 契約 / 決済。
## Step 6
ダッシュボード。
## Step 7
CRM。
## Step 8
アンバサダー。
## Step 9
TimeRex / consultation。
## Step 10
GA4 / Search Console等。
---
# 39. 推奨vertical slice
まず1医院で以下が動けばよい。
```text
医院URL
↓
医院情報
↓
競合3院
↓
患者質問
↓
AI結果
↓
AI推薦シェア
↓
勝敗
↓
敗因
↓
改善TOP3
↓
診断画面
```
この流れを成立させてから周辺機能を増やす。
---
# 40. プロダクトの判断基準
新機能を追加するときは必ず問う：
1. 院長の意思決定が早くなるか？
2. 予約・新患につながるか？
3. 競合との差が分かるか？
4. 次の行動が具体的になるか？
5. 歯科医院専用である意味が強くなるか？
6. 営業マンなしで利用開始しやすくなるか？
7. P0に本当に必要か？
3つ以上「No」なら、MVPでは後回し。
---
# 41. 最終ゴール
DENT SHIFTが目指すのは、
> 「AI分析レポートを出すサービス」
ではない。
院長が、
> 「自院がAIでどう見られているか」  
> 「近隣のどこに負けているか」  
> 「何を直せばいいか」  
> 「直した結果、予約・新患がどう変わったか」
を一つの画面で理解し、
営業担当に電話されることなく、
必要な改善を自分で判断できる世界を作る。
**AIが分析し、必要なときだけ人が支える。**
**歯科集患を、AIでシフトする。**
---
# 42. Claude Codeへの最終指示
```text
ここまでの仕様を読んだら、いきなり大量実装を始めないでください。
まず既存リポジトリを確認し、
以下を提示してください。
A. 現在の技術スタック
B. 現在のディレクトリ構成
C. 実装済み機能
D. P0に対する不足
E. 仕様と実装の衝突
F. セキュリティ上の問題
G. 2026-10-01 MVPへ向けた実装順
H. 最初に着手する小さなタスク
そのうえで IMPLEMENTATION_PLAN.md を作り、
P0を最優先で順番に実装してください。
大規模な仕様変更、料金変更、データモデル破壊、
患者個人情報の取得、外部サービスへの無承認書き込みは
絶対に行わないでください。
実装は「動くデモ」ではなく、
本番へ段階的に育てられる構造を優先してください。
```
---
## END
