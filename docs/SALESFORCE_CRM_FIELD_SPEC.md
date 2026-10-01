# Salesforce連携 項目一覧(自動生成)

このファイルは `salesforce/tools/generate.py` が `salesforce/tools/fields.json` から生成する。手で編集しない。
メタデータ本体は `salesforce/force-app/main/default/` 、デプロイ対象一覧は `salesforce/manifest/package.xml`。

- 追加する項目: 80件 / 追加するカスタムオブジェクト: 2件 / 権限セット: 2件
- 既存項目(`Event_Type__c` / `Registration_Step__c` / `Trial_Ends_At__c`)は変更しない。
- 権限: 連携ユーザーには権限セット `DentShift_Integration`(連携項目の編集・削除権限なし)、営業・CS担当には `DentShift_Sales_Staff`(連携項目は閲覧のみ、相談の実施結果・メモだけ編集)。
- 外部ID項目はアプリのID(医院ID・ユーザーID・契約ID・診断ID)とTimeRexの予約IDのみ。メールアドレスは外部IDにしない。

| オブジェクト | API参照名 | 型・桁 | 一意性 | 用途 | 書き込み | 営業・CS権限 |
|---|---|---|---|---|---|---|
| リード (`Lead`) | `DentShift_Clinic_Id__c` | テキスト(外部ID・一意・大文字小文字区別) 64 | 一意 | DENT SHIFTの医院ID(外部ID・一意) | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Last_Diagnosed_At__c` | 日付/時間  |  | 最終診断日時 | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Diagnosis_Count__c` | 数値 6,0 |  | 診断回数 | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Diagnosis_Url__c` | URL  |  | 最新の診断結果ページ | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Site_Domain__c` | テキスト 255 |  | 診断対象サイトのドメイン(重複確認の参考値) | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_UTM_Source__c` | テキスト 255 |  | 初回流入 utm_source | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_UTM_Medium__c` | テキスト 255 |  | 初回流入 utm_medium | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_UTM_Campaign__c` | テキスト 255 |  | 初回流入 utm_campaign | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_UTM_Content__c` | テキスト 255 |  | 初回流入 utm_content | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_UTM_Term__c` | テキスト 255 |  | 初回流入 utm_term | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Signed_Up_At__c` | 日付/時間  |  | 会員登録日時 | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Latest_Score__c` | 数値 5,0 |  | 最新診断の総合スコア | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Latest_Status__c` | テキスト 40 |  | 最新診断の総合判定 | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Latest_Provisional__c` | チェックボックス  |  | 最新診断が暫定値(サンプル/計測不能を含む)か | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Consultation_Cta_Clicked_At__c` | 日付/時間  |  | 相談CTAの最終クリック日時 | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Consultation_Cta_Clicks__c` | 数値 6,0 |  | 相談CTAのクリック回数 | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Trial_Signup_Started_At__c` | 日付/時間  |  | 会員登録・トライアル申込の開始日時(初回) | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Consultation_Status__c` | テキスト 40 |  | 直近の相談予約の状態(予約成立/キャンセル) | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `DentShift_Next_Consultation_At__c` | 日付/時間  |  | 次回の相談予約日時(予約成立のもの) | 連携ユーザー | 閲覧 |
| リード (`Lead`) | `Event_Type__c` | 既存項目(変更しない)  |  | 最後に同期したイベント種別(既存項目) | 既存 | 閲覧 |
| リード (`Lead`) | `Registration_Step__c` | 既存項目(変更しない)  |  | 登録ステップ(既存項目) | 既存 | 閲覧 |
| リード (`Lead`) | `Trial_Ends_At__c` | 既存項目(変更しない)  |  | トライアル終了予定(既存項目) | 既存 | 閲覧 |
| 取引先 (`Account`) | `DentShift_Clinic_Id__c` | テキスト(外部ID・一意・大文字小文字区別) 64 | 一意 | DENT SHIFTの医院ID(外部ID・一意) | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Site_Domain__c` | テキスト 255 |  | 医院サイトのドメイン | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Signed_Up_At__c` | 日付/時間  |  | 会員登録日時 | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Current_Plan__c` | テキスト 40 |  | 契約プラン(最新の契約) | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Contract_Status__c` | テキスト 40 |  | 契約状態(最新の契約) | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Ops_Url__c` | URL  |  | DENT SHIFT管理画面(連携イベント)への参照 | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Latest_Score__c` | 数値 5,0 |  | 最新診断の総合スコア | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Latest_Status__c` | テキスト 40 |  | 最新診断の総合判定 | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Latest_Provisional__c` | チェックボックス  |  | 最新診断が暫定値(サンプル/計測不能を含む)か | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Consultation_Cta_Clicked_At__c` | 日付/時間  |  | 相談CTAの最終クリック日時 | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Consultation_Cta_Clicks__c` | 数値 6,0 |  | 相談CTAのクリック回数 | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Trial_Signup_Started_At__c` | 日付/時間  |  | 会員登録・トライアル申込の開始日時(初回) | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Consultation_Status__c` | テキスト 40 |  | 直近の相談予約の状態(予約成立/キャンセル) | 連携ユーザー | 閲覧 |
| 取引先 (`Account`) | `DentShift_Next_Consultation_At__c` | 日付/時間  |  | 次回の相談予約日時(予約成立のもの) | 連携ユーザー | 閲覧 |
| 取引先責任者 (`Contact`) | `DentShift_User_Id__c` | テキスト(外部ID・一意・大文字小文字区別) 64 | 一意 | DENT SHIFTのユーザーID(外部ID・一意) | 連携ユーザー | 閲覧 |
| 取引先責任者 (`Contact`) | `DentShift_Role__c` | テキスト 20 |  | 医院内の役割(owner/staff/agency) | 連携ユーザー | 閲覧 |
| 取引先責任者 (`Contact`) | `DentShift_Registration_Step__c` | テキスト 20 |  | 登録ステップ | 連携ユーザー | 閲覧 |
| 取引先責任者 (`Contact`) | `DentShift_Email_Verified_At__c` | 日付/時間  |  | メール確認日時(本人確認) | 連携ユーザー | 閲覧 |
| 取引先責任者 (`Contact`) | `DentShift_Phone_Verified_At__c` | 日付/時間  |  | SMS確認日時(本人確認) | 連携ユーザー | 閲覧 |
| 取引先責任者 (`Contact`) | `DentShift_SMS_Verification_Exempt__c` | チェックボックス  |  | SMS確認の例外対象 | 連携ユーザー | 閲覧 |
| 取引先責任者 (`Contact`) | `DentShift_Consent_Accepted_At__c` | 日付/時間  |  | 規約同意日時 | 連携ユーザー | 閲覧 |
| 取引先責任者 (`Contact`) | `DentShift_Signed_Up_At__c` | 日付/時間  |  | 会員登録日時 | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Subscription_Id__c` | テキスト(外部ID・一意・大文字小文字区別) 64 | 一意 | DENT SHIFTの契約ID(外部ID・一意) | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Plan__c` | テキスト 20 |  | プラン | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Billing_Status__c` | テキスト 30 |  | 契約状態(trial/active/past_due/cancelled等) | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Trial_Started_At__c` | 日付/時間  |  | トライアル開始日時 | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Trial_Ends_At__c` | 日付/時間  |  | トライアル終了予定 | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Payment_Method_Status__c` | テキスト 30 |  | 支払方法の登録状態(カード情報は含まない) | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Paid_Started_At__c` | 日付/時間  |  | 有料契約の開始日時(初回) | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Next_Renewal_Date__c` | 日付  |  | 次回更新日 | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Cancel_At_Period_End__c` | チェックボックス  |  | 期間末で解約予定 | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Cancel_Requested_At__c` | 日付/時間  |  | 解約申請日時 | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Cancel_At__c` | 日付/時間  |  | 解約予定日時 | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Ended_At__c` | 日付/時間  |  | 契約終了日時 | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Billing_Exempt__c` | チェックボックス  |  | 課金免除(永久無料) | 連携ユーザー | 閲覧 |
| 商談 (`Opportunity`) | `DentShift_Pilot__c` | チェックボックス  |  | Pilot(先行利用)契約 | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Diagnosis_Id__c` | テキスト(外部ID・一意・大文字小文字区別) 64 | 一意 | DENT SHIFTの診断ID(外部ID・一意) | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Clinic_Id__c` | テキスト(外部ID・重複可、検索用インデックス) 64 | 外部ID(重複可) | DENT SHIFTの医院ID(リード・取引先と同じ値) | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Account__c` | 参照関係 → Account |  | 取引先(会員登録済みの医院のみ) | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Measured_At__c` | 日付/時間  |  | 診断完了日時 | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Target_Url__c` | テキスト 255 |  | 診断対象URL | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Total_Score__c` | 数値 5,0 |  | 総合スコア | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Total_Status__c` | テキスト 40 |  | 総合判定 | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Provisional__c` | チェックボックス  |  | 暫定値(サンプル/計測不能を含む) | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_AI_Exposure__c` | テキスト 255 |  | AI露出状況の要約 | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Improvement_Summary__c` | ロングテキストエリア 2000 |  | 改善提案の概要(上位3件) | 連携ユーザー | 閲覧 |
| DENT SHIFT診断 (`DentShift_Diagnosis__c`) | `DentShift_Result_Url__c` | URL  |  | 診断結果ページ | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_TimeRex_Event_Id__c` | テキスト(外部ID・一意・大文字小文字区別) 64 | 一意 | TimeRexの予約ID(外部ID・一意) | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Clinic_Id__c` | テキスト(外部ID・重複可、検索用インデックス) 64 | 外部ID(重複可) | DENT SHIFTの医院ID(リード・取引先と同じ値) | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Account__c` | 参照関係 → Account |  | 取引先(会員登録済みの医院のみ) | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Contact__c` | 参照関係 → Contact |  | 予約した担当者(会員と一致した場合のみ) | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Booking_Status__c` | テキスト 20 |  | 予約状態(予約成立/キャンセル。TimeRex通知の値) | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Start_At__c` | 日付/時間  |  | 相談開始日時 | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_End_At__c` | 日付/時間  |  | 相談終了日時 | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Booked_At__c` | 日付/時間  |  | 予約日時(TimeRexで予約された時刻) | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Canceled_At__c` | 日付/時間  |  | キャンセル日時 | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Host_Name__c` | テキスト 80 |  | TimeRexの担当(ホスト) | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Calendar_Name__c` | テキスト 80 |  | TimeRexカレンダー名 | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Match_Method__c` | テキスト 20 |  | 医院との対応付け方法(signed_ref/contact_email) | 連携ユーザー | 閲覧 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Attendance__c` | 選択リスト 未記録 / 実施 / 不参加 / 日程変更 |  | 相談の実施結果(担当者が入力。同期では書き込まない) | 担当者が入力(同期しない) | 編集 |
| DENT SHIFT相談予約 (`DentShift_Consultation__c`) | `DentShift_Staff_Notes__c` | ロングテキストエリア 5000 |  | 担当者メモ(同期では書き込まない) | 担当者が入力(同期しない) | 編集 |
