# DENT SHIFT — Data Model (P0)

`clinic_id` を全テナントデータのisolation軸とする。患者個人情報(氏名・電話・メール・病歴・診療記録・相談本文・予約フォーム本文)は**いかなるテーブルにも保存しない**。

以下はP0で必要な最小集合。フルモデル一覧(将来分含む)は末尾の「P1/P2で追加」を参照。

## clinics
医院そのもの。テナントの単位。

- `id` (clinic_id, PK)
- `name`
- `official_url`
- `contact_email` (医院の代表連絡先。患者情報ではない)
- `gbp_url` (任意)
- `booking_url` (任意)
- `departments` (診療科目, 任意)
- `focus_treatments` (強化したい自費診療, 任意)
- `service_area` (商圏, 任意)
- `nearest_station` (任意)
- `business_hours` (任意)
- `director_name` (院長名, 任意)
- `status` (`lead` / `trial` / `active` / `restricted` / `suspended` / `cancelled`)
- `created_at`, `updated_at`

## contacts
医院側の「人」(院長・スタッフ・制作会社担当)。患者ではない。

- `id`
- `clinic_id` (FK)
- `role` (`owner` / `staff` / `agency`)
- `email`
- `display_name`
- `auth_user_id` (Auth基盤側のユーザーIDへの参照)
- `created_at`

## diagnoses
無料診断〜再計測の実行単位。

- `id`
- `clinic_id` (FK)
- `status` (`queued` / `running` / `completed` / `failed`)
- `score_total`, `score_aio`, `score_meo`, `score_seo`, `score_llmo`, `score_booking`, `score_reputation`
- `is_sample` (mock/サンプルデータかどうかを明示するフラグ。実績表示禁止判定に使用)
- `measurement_condition` (計測条件のスナップショット: 使用AI、地域、日時等)
- `captured_at`
- `created_at`

## competitors
診断ごとの比較対象医院(自院が指定 or システムが検出)。

- `id`
- `diagnosis_id` (FK)
- `clinic_name`
- `source_url`
- `rank_vs_self` (任意)
- `created_at`

## ai_observations
AI別・質問別の計測結果本体。

- `id`
- `diagnosis_id` (FK)
- `ai_provider` (`chatgpt` / `gemini` / 他)
- `model`
- `patient_question`
- `response` (取得した生の応答、または要約)
- `mention` (bool)
- `recommendation_rank` (nullable。取得不能時は **null**、0にしない)
- `citations` (JSON配列)
- `competitor_mentions` (JSON配列)
- `region`
- `evidence` (根拠テキスト/リンク)
- `previous_diff` (前回計測との差分、nullable)
- `is_sample`
- `captured_at`

## improvement_tasks
改善提案〜対応状況の管理。

- `id`
- `clinic_id` (FK)
- `diagnosis_id` (FK, 発生元)
- `title`
- `category` (AIO/MEO/SEO/LLMO/予約導線/口コミ 等)
- `status` (`detected` → `proposed` → `approved` → `not_started` → `in_progress` → `pending_confirmation` → `done` → `remeasuring` → `impact_confirmed`)
- `requires_external_write` (bool。true の場合は人承認必須。`SECURITY.md` 参照)
- `approved_by`, `approved_at` (nullable)
- `created_at`, `updated_at`

## subscriptions
契約・プラン状態(Webhook駆動、Stripe等を想定)。

- `id`
- `clinic_id` (FK)
- `plan`
- `status` (`trial` / `active` / `past_due` / `restricted` / `suspended` / `cancel_scheduled` / `cancelled`)
- `external_subscription_id` (決済サービス側ID)
- `created_at`, `updated_at`

## payments
決済イベントの記録(カード番号等は保存しない。決済サービス側トークンのみ)。

- `id`
- `subscription_id` (FK)
- `status`
- `external_payment_id`
- `occurred_at`

## ambassadors / attributions
紹介経由の成果追跡。

- `ambassadors`: `id`, `contact_id` or `clinic_id`, `referral_code`, `created_at`
- `attributions`: `id`, `referral_code`, `referred_clinic_id`, `stage` (`diagnosis` / `contract` / `first_payment`), `occurred_at` — 成果は「有料契約 + 初回入金完了」時点のみ確定、クリックだけでは成果にしない

## audit_logs
外部書き込み承認・重要操作の監査証跡(必須)。

- `id`
- `actor_contact_id` (社内オペレーターのcontact/user)
- `clinic_id`
- `action` (例: `advertising.update`, `gbp.update`, `improvement_task.approve`)
- `target_type`, `target_id`
- `before`, `after` (JSON diff)
- `created_at`

## 保存禁止(再掲・DBレベルのバリデーションで強制する)

患者氏名 / 患者電話番号 / 患者メール / 病歴 / 診療記録 / 相談内容本文 / 予約フォーム入力本文 / カード番号 / パスワード平文 / アクセストークン平文

## テナント分離

- 全テーブル(グローバル設定を除く)は直接または間接に `clinic_id` を持つ。
- Postgres RLSポリシーで「自分の `clinic_id` 以外は参照不可」を宣言的に強制し、アプリケーション層のバグに依存しない二重防御とする。
- 運営(管理/CS/分析/経理)側ロールは、監査ログを残す専用の service role 経由でのみクロステナント参照を許可する。

## P1/P2で追加(P0時点ではテーブルのみ確保、実装は後続)

`onboarding_steps`, `integrations`, `appointments`, `support_cases`, `activities`, `notifications`
