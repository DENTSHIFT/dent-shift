# `dent-shift-test` 次回デプロイ実行計画 — 2026-10-03時点

本ドキュメントは計画の作成のみを目的とする。実際のデプロイ・環境変数変更・外部設定変更はこの作業では行っていない。

## 0. 前提

- 前回配備済みコミット: `583316c`(`fix(timerex): stop importing server-only bookingRef.ts into the client bundle`)。
  - 裏付け: `docs/TIMEREX_URL_PARAMS_INVESTIGATION_2026-10-03.md` 等、直近の調査ドキュメント群がこのコミット以降の状態を前提に書かれており、`git log --oneline 583316c..HEAD` が本ドキュメント作成時点の未配備差分と一致することを確認した。
  - 現ブランチ: `feature/salesforce-crm-sync`(masterへ未マージ)。

## 1. 配備対象コミット(`583316c..HEAD`、28件)

カテゴリ別に整理する(新しい順):

### A. SMSガード新規実装・修正(配備の主目的)
- `d7908cb` fix(sms): test-send allowlistを非本番で必須化、実際の未認証ルートでテスト
- `41f005e` feat(sms): テスト環境向け送信許可リスト(last line of defense)を新規実装
- `2fc87a5` test(sms): OTP拒否/期限切れ/ロックアウト、resendのレート制限/クールダウン/リトライをカバー

### B. メール確認画面修正(`verify-email`)
- `6905120` fix(auth): already-verifiedの文言が「古いリンク自体が成功した」ように見えないよう修正(`already_verified_via_session`ステータスを分離)
- `6f042a0` fix(auth): 既に確認済みのセッションに対して「リンクが無効」と伝えないよう修正

### C. CRON認証修正
- `321c2c2` fix(salesforce): `CRON_SECRET`認証チェックをtiming-safe比較に変更

### D. Salesforce関連(ドキュメント中心、コード変更は上記Cのみ)
- `eefabfa` `63ce9a4` `81d692e`(一部) `b955ea9` `b616693` `a296dff` `36c6955` `ad9452b` `b2f73de`
  (Lead手動変換手順、Sandbox読み取り専用確認、master差分整理など、いずれもドキュメントのみ)

### E. SMS/Twilio調査・ドキュメントのみ
- `cf3c941` `0d72b59` `2798881` `c00c80f` `3c1b479` `7ea1a07`
  (ガード設計の記録、Twilio問い合わせ下書き、料金確認、コスト前提の撤回など)

### F. ドキュメントのみ(その他)
- `70be9d3` Twilioサポート送信チケット記録
- `86663e3` test(sms): `APP_BASE_URL`欠落/不正系のテスト追加(テストのみ、本体ロジック変更なし)
- `9adbe6c` 本番移行計画ドキュメント追加
- `70a0c4f` 検証環境の戻す/残す対象チェックリスト追加
- `8de3439` TimeRex url_params/ds_ref調査記録
- `bacdf3a` chore(launch): 既存entryのフォーマット復元のみ

**配備時の実質的な挙動変化**はA(SMSガード)・B(メール確認画面)・C(CRON timing-safe比較)の3点のみ。D〜Fはコード変更を伴わないドキュメント/テスト追加。

## 2. 新規に必要な環境変数

`src/server/providers/sms/smsTestSendAllowlist.ts` を確認した結果、新規に必要になる環境変数は以下2点(両方セットでのみ有効):

| 変数名 | 用途 |
|---|---|
| `SMS_TEST_ALLOWED_CONTACT_ID` | 非本番環境でSMS送信を許可する唯一のContact ID |
| `SMS_TEST_ALLOWED_PHONE` | 上記Contactに対応する、送信許可する電話番号(E.164形式、`+`に続く7〜15桁の数字) |

判定ロジック:
- `APP_BASE_URL` のホストが本番ドメイン(`dentshift.jp` / `www.dentshift.jp` / `app.dentshift.jp`)の場合のみ常時許可(ガード無効)。
- それ以外(`test.dentshift.jp`、Vercel Preview URL、`APP_BASE_URL`未設定・不正含む)では、上記2変数が**両方設定され、かつ両方が一致**した場合のみ許可。いずれか欠落・不一致・不正形式は拒否(503想定)。

**`SMS_PROVIDER` は `disabled` のまま維持する。** 今回のデプロイではSMS実送信を有効化しない。上記2変数を設定してもテスト目的の許可判定ロジックが動くだけで、`SMS_PROVIDER=disabled`であれば実際の送信は発生しない構成とする(実送信は別途承認後の作業とする)。

## 3. 事前確認

- [ ] `dent-shift-test` の Vercel 環境変数で、現在の `APP_BASE_URL` が `https://test.dentshift.jp` 系の値であることを確認する(本番ドメイン判定に引っかからないことの確認。`VERCEL_ENV` は test.dentshift.jp でも `production` を返すため使えない点に注意)。
- [ ] `SMS_PROVIDER` が現在 `disabled` であることを確認する(本デプロイで変更しないことの確認)。
- [ ] `SMS_TEST_ALLOWED_CONTACT_ID` / `SMS_TEST_ALLOWED_PHONE` が未設定の場合、新規に値を設定するか、今回は未設定のまま(=SMS送信は非本番では常に拒否される状態)でデプロイするかを決める。未設定でもエラーにはならず、単に非本番では常に拒否(503)になるだけなので、値を用意できない場合は未設定のままでも安全側。
- [ ] 既存のテストアカウント(`info@dentshift.jp` 管理者、`dsverify` Sandboxのテストデータ等、`docs/TEST_ENVIRONMENT_CLEANUP_CHECKLIST_2026-10-03.md` 参照)の状態に変更がないか確認する。
- [ ] `smsVerificationExempt` フラグが設定されているContactの一覧を確認する(本デプロイでは変更しない前提の裏付け)。

## 4. デプロイ後の確認手順

### 4-1. メール確認画面(`already_verified_via_session`、commit `6905120`)

1. ブラウザで、既にメール確認済みのアカウントにログインした状態を作る。
2. 古い(使用済み・無効な)確認リンクに直接アクセスする(`/verify-email?token=...`)。
3. 画面に表示される文言が「このリンクは無効/使用済みですが、ログイン中のアカウントは既に確認済みです」という趣旨になっていること(「確認が完了しました」という、古いリンク自体が成功したかのような文言になっていないこと)を目視確認する。
4. 開発者ツールのNetworkタブで、このリクエストがDB書き込み(PATCH/UPDATE相当)を伴っていないことを確認する(`src/server/services/verifyEmailToken.ts` のセッションフォールバック経路はDB書き込みなしの設計)。

### 4-2. SMS送信拒否の確認(実送信なし、`SMS_PROVIDER=disabled`を維持)

`SMS_PROVIDER=disabled` のまま、ガードロジック自体の応答コードを確認する(実際にTwilio等への送信は発生しない):

1. `SMS_TEST_ALLOWED_CONTACT_ID` / `SMS_TEST_ALLOWED_PHONE` を未設定、または意図的に実際のテストContactと異なる値にしたまま、SMS認証フローの実際のエンドポイント(例: パスワードリセットのSMS送信API、または該当のOTP送信ルート)に対して、許可されていない組み合わせでリクエストを送る。
   - curl例(エンドポイントは実装に合わせて調整。認証が必要な場合は事前にセッション/CSRF等を取得した上で実行する):
     ```
     curl -i -X POST https://test.dentshift.jp/api/<該当のSMS送信ルート> \
       -H "Content-Type: application/json" \
       -d '{"contactId":"存在しないか許可外のID","phoneNumberE164":"+819000000000"}'
     ```
   - 期待結果: 503相当(または実装側で定義された拒否レスポンス)が返り、Twilio等への実送信ログが発生しないこと。
2. ブラウザの開発者ツール(Network タブ)から同様のリクエストをアプリのUI操作経由で発生させ、レスポンスステータスとレスポンスボディを確認する方法でも代替可能(curlで直接叩けない場合)。
3. どちらの方法でも、実際の電話番号へのSMSが送信されていないこと(Twilioコンソールのログ、または `SMS_PROVIDER=disabled` により送信処理自体が到達しないこと)を確認する。
4. (任意、値を設定した場合のみ) `SMS_TEST_ALLOWED_CONTACT_ID` / `SMS_TEST_ALLOWED_PHONE` に一致する組み合わせでリクエストを送り、ガードが通過する(拒否されない)ことを確認する。ただし `SMS_PROVIDER=disabled` のため、この場合も実際の送信は発生しない。

### 4-3. CRON認証(timing-safe比較、commit `321c2c2`)

- 既存のCRONジョブが正常に認証・実行されることを確認する(ロジック変更はtiming-safe比較への置き換えのみで、正しい`CRON_SECRET`での動作自体に変更はない想定)。

## 5. ロールバック手順(Vercel)

問題が発生した場合、`583316c` 時点のデプロイへ切り戻す:

1. Vercelダッシュボードで `dent-shift-test` プロジェクトを開き、「Deployments」タブを開く。
2. コミット `583316c`(`fix(timerex): stop importing server-only bookingRef.ts into the client bundle`)に対応するデプロイメントを履歴から探す(デプロイ一覧のコミットハッシュ/メッセージで識別)。
3. 該当デプロイメントの「...」メニューから「Promote to Production」(環境名が`dent-shift-test`の場合はそのエイリアスへのPromote)を選択し、確認の上実行する。
   - 別名: デプロイ詳細画面の「Redeploy」ではなく、既存の過去ビルドをそのまま現在のエイリアスに割り当てる操作を選ぶこと(ソースを再ビルドし直すと最新コミットに戻ってしまうため)。
4. Promote後、`https://test.dentshift.jp` にアクセスし、レスポンスヘッダまたはデプロイ詳細から反映されたコミットハッシュが `583316c` であることを確認する。
5. 今回追加した環境変数(`SMS_TEST_ALLOWED_CONTACT_ID` / `SMS_TEST_ALLOWED_PHONE`)を設定していた場合、ロールバック後も残存するが、`583316c`時点のコードはこれらの変数を参照しないため実害はない。切り戻し後に撤去するか残すかは別途判断する。
6. ロールバック実施後、原因調査のためこのデプロイ計画書に結果を追記する。

## まとめ

- 配備対象は28コミット。実質的な挙動変化はSMSガード新規実装・メール確認画面の文言修正・CRON認証のtiming-safe化の3点のみで、残りはドキュメント/テスト追加。
- 新規環境変数は `SMS_TEST_ALLOWED_CONTACT_ID` / `SMS_TEST_ALLOWED_PHONE` の2点。`SMS_PROVIDER=disabled` は変更しない。
- ロールバックは Vercel の「Promote to Production」で `583316c` 時点のビルドに切り戻す。
