# DENT SHIFT Google Integration Spec

Updated: 2026-09-04

## 1. 基本方針

DENT SHIFTは歯科医院ごとのGoogleデータを clinic_id 単位で管理する。

Google連携は医院側の明示的なOAuth承認を必須とする。

原則：
- 患者個人情報は取得・保存しない
- 必要最小限のOAuth scopeを使用
- read / writeを分離する
- P0では分析・可視化を優先し、外部変更は原則行わない
- tokenやclient secretをソースコードへ直書きしない
- refresh tokenは暗号化して保存
- API取得不能を0として表示しない
- 再認証が必要な状態をUIで明示する
- clinic_idを必ず連携レコードへ紐付ける
- 全重要操作をaudit logへ記録する

## 2. P0 Google連携

### 2.1 Google Analytics 4

目的：
- サイト流入
- AI由来流入
- 診療ページ閲覧
- 予約CTAクリック
- 予約フォーム開始
- 予約完了
- コンバージョン傾向

使用候補：
- Google Analytics Data API
- Google Analytics Admin API

基本scope：
https://www.googleapis.com/auth/analytics.readonly

医院ごとにGA4 propertyを選択・保存する。

保存候補：
- clinic_id
- google_account_connection_id
- ga4_property_id
- property_display_name
- connected_at
- last_synced_at
- connection_status

患者単位の識別情報をDENT SHIFTへ保存しない。

### 2.2 Google Search Console

目的：
- 検索クエリ
- 表示回数
- クリック
- CTR
- 平均掲載順位
- ページ別検索実績
- 非指名検索
- 診療テーマ別の検索需要

基本scope：
https://www.googleapis.com/auth/webmasters.readonly

医院ごとにSearch Console propertyを選択する。

保存候補：
- clinic_id
- search_console_site_url
- connected_at
- last_synced_at
- connection_status

APIエラー・権限不足・データ不足は0件として扱わない。

## 3. GTM / 計測設計

DENT SHIFTが推奨する主要イベント：

- booking_cta_click
- booking_form_start
- booking_complete
- phone_click
- map_click
- treatment_page_view
- pricing_page_view
- doctor_profile_view
- faq_view

推奨パラメータ：
- clinic_id
- page_path
- treatment_category
- traffic_source
- device_category

患者氏名、電話番号、メールアドレス、相談内容はイベントパラメータへ送信しない。

GTMの自動公開は行わない。
設定案を提示し、医院または制作会社が承認して公開する。

## 4. P1 Google Business Profile

目的：
- 医院基本情報
- 営業時間
- 写真
- 口コミ関連情報
- ローカル集患分析
- GBPパフォーマンス

OAuth scope候補：
https://www.googleapis.com/auth/business.manage

DENT SHIFTは医院が管理権限を持つBusiness Profileのみ扱う。

P1初期はread中心。
プロフィール情報変更・投稿・口コミ返信等のwrite操作は必ず人の明示承認を要求する。

## 5. P1 Google Ads

目的：
- 広告費
- 表示
- クリック
- コンバージョン
- 診療メニュー別成果
- 自然AI流入と広告流入の分離

Google Ads APIはOAuthに加えてDeveloper Tokenが必要。

DENT SHIFT初期実装はread-onlyの分析用途を優先する。

広告予算変更、配信設定変更、広告文変更、停止・開始は自動実行しない。
人の承認を必須とする。

## 6. OAuth設計

推奨フロー：

DENT SHIFT設定画面
→ Google連携
→ Google OAuth consent
→ callback
→ clinic_idへconnection作成
→ 利用可能account/property/location一覧取得
→ 医院が対象を選択
→ 保存
→ 初回同期
→ dashboard表示

OAuth stateにはCSRF対策を実装する。

redirect URIは環境別に分離する。

例：
Development:
http://localhost:3000/api/integrations/google/callback

Production:
https://{production-domain}/api/integrations/google/callback

本番domain確定後に更新すること。

## 7. 環境変数

最低限：

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_TOKEN_ENCRYPTION_KEY=

Google Ads使用時：
GOOGLE_ADS_DEVELOPER_TOKEN=

値そのものをGitへcommitしない。

.env.exampleにはキー名だけ記載する。

## 8. Connection Status

想定status：

- not_connected
- connected
- needs_reauth
- insufficient_permissions
- temporarily_unavailable
- revoked
- error

UIでは「0件」と「取得不能」を区別する。

## 9. DB候補

integration_connections

- id
- clinic_id
- provider
- google_account_id
- encrypted_refresh_token
- granted_scopes
- connection_status
- connected_at
- last_synced_at
- last_error_code
- created_at
- updated_at

integration_resources

- id
- connection_id
- resource_type
- external_resource_id
- display_name
- selected
- metadata
- created_at
- updated_at

## 10. Security

- OAuth token平文保存禁止
- client secret平文commit禁止
- server-side only
- clinic_id tenant isolation
- token refresh failure時はneeds_reauth
- provider errorをユーザー向け0値へ変換しない
- logsへtokenを出力しない
- write操作は人承認
- audit logを残す
- OAuth scope追加時は再同意を求める

## 11. 実装優先順位

P0:
1. Google OAuth共通基盤
2. GA4接続
3. Search Console接続
4. property選択
5. connection status
6. dashboardへのread-only表示
7. retry / error / reauth

P1:
8. Google Business Profile
9. Google Ads
10. GTM支援
11. Google Calendar / Meet

## 12. Claudeへのルール

このファイルをGoogle連携の正本として扱う。

実装開始前に必ず最新のGoogle公式API・OAuth・利用規約を確認する。

API名・scope・利用条件が変更されている場合、
コードを勝手に合わせる前に差分を報告する。

患者個人情報をGoogle APIレスポンスからDENT SHIFTへ保存しない。

外部のwrite操作を無承認で実行しない。
