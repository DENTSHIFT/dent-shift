# Stage 1 検証手順(ローカルDB + Salesforce Sandbox、Stripe・TimeRexはシミュレーション)

更新: 2026-10-01。承認依頼は「Sandbox作成・Sandbox内設定・Stage 1実行」をまとめて行う。**本番組織・本番アプリ・本番の接続アプリ/実行ユーザー/認証情報・既存31件のリードは一切変更しない。**

## Stage 1 で確認できること / できないこと

| 区分 | 内容 |
|---|---|
| 確認できる(完了条件) | Salesforce上で1医院の診断・契約・相談履歴がつながって見える / 同じイベントの再送・Webhook再通知で重複しない / 古いイベントで状態が戻らない / 通信失敗時にfailedとなり再試行で回復する / 同じ医院の同時同期が直列化される / 連携専用ユーザー(最小権限)で書き込める |
| 確認できない(別途検証が必要) | TimeRexの実予約(`url_params` による医院紐付け、日程変更の実際の通知形式)/ Stripeからの実イベント受信(署名検証・到着順・実際の項目値)/ 本番相当のアプリ環境(Vercel・本番DB)での動作 / 実際のメール送信 |

**Stage 1 の成功は「連携全体の検証完了」ではない。** 上記の「確認できない」項目は、分離が確認された環境で別途検証する。

## 分離の構成

| 対象 | Stage 1 の構成 | 本番への影響 |
|---|---|---|
| DENT SHIFT のDB | 実行ごとに作る一時SQLite(全マイグレーション適用) | なし |
| Salesforce | Developer Sandbox `dsverify`(スクリプトは `IsSandbox=true` と組織IDの一致を確認できなければ停止) | なし |
| 認証 | Sandbox内だけに作る外部クライアントアプリ(独自の認証情報)。本番の接続アプリは使わない・変更しない | なし |
| Stripe | 実イベントは受けない。同じ処理関数(`applyBillingWebhookEvent`)へ確定イベントと同形式のデータを渡す | 課金なし |
| TimeRex | 実予約は行わない。同じ処理関数(`applyTimeRexBooking`)へ公式仕様の形式のデータを渡す | 本番予約ページ・Webhook変更なし |
| メール | 送信しない(失敗通知メールの宛先設定を外して実行) | なし |

## 項目数(55と80の違い)

集計範囲の違いで、追加仕様ではない。

| オブジェクト | 追加項目 |
|---|---|
| リード | 19 |
| 取引先 | 14 |
| 取引先責任者 | 8 |
| 商談 | 14 |
| **標準オブジェクト小計** | **55** |
| DENT SHIFT診断(新規オブジェクト) | 11 |
| DENT SHIFT相談予約(新規オブジェクト) | 14 |
| **新規オブジェクト小計** | **25** |
| **合計** | **80** |

(既存のリード項目3件 `Event_Type__c` / `Registration_Step__c` / `Trial_Ends_At__c` は変更せず、件数に含めない。)

## 承認依頼の対象(条件がそろってからまとめて依頼)

前提条件(読み取りで確認):
1. 接続先組織が有料契約の組織であること(完全な組織ID同士で照合)
2. 設定 > Sandbox に、追加費用なしで使える Developer の空き枠があること

承認をお願いする操作:
| # | 操作 | 実施場所 |
|---|---|---|
| 1 | Developer Sandbox `dsverify` の作成 | 本番組織の 設定 > Sandbox(作成操作のみ。本番のデータ・設定は変わらない) |
| 2 | Sandbox内に外部クライアントアプリ(Client Credentials)を作成。設定作業中の実行ユーザーはSandbox管理者、Stage 1 実行時は連携専用ユーザーへ切替 | Sandboxのみ |
| 3 | Sandboxへ項目80・オブジェクト2・権限セット2を反映、画面レイアウトを追加 | Sandboxのみ |
| 4 | 連携専用ユーザー `dentshift.sync@mcollection-japan.jp.dsverify` を作成(Salesforce Integrationライセンス+最小権限) | Sandboxのみ |
| 5 | Stage 1 実行(検証データの作成・更新)、画面確認、必要に応じて検証データ削除 | Sandboxのみ |

## 手順

| # | 手順 | 実施者 | コマンド・画面 |
|---|---|---|---|
| 1 | Sandbox作成(Developerは通常数分〜1時間程度) | Claude(承認後、ブラウザ画面操作) | 設定 > Sandbox > 新規Sandbox |
| 2 | Sandboxへログイン(ユーザー名は本番ユーザー名+`.dsverify`) | 木村さん(パスワード入力) | test.salesforce.com またはSandboxのMy Domain |
| 3 | 外部クライアントアプリ作成、認証情報を `salesforce/.env.sandbox` へ記入 | Claude(画面操作)/ 認証情報の転記は木村さん | `salesforce/.env.sandbox.example` をコピー |
| 4 | 項目・オブジェクト・権限セット反映 | Claude | `node scripts/salesforce-metadata-deploy.mjs`(検証)→ `--deploy` |
| 5 | 画面レイアウト追加 | Claude | `node scripts/salesforce-layout-setup.mjs --apply` |
| 6 | 連携専用ユーザー作成・権限付与 | Claude | `node scripts/salesforce-sandbox-integration-user.mjs --apply` |
| 7 | 外部クライアントアプリの実行ユーザーを連携専用ユーザーへ切替 | Claude(画面操作) | アプリのポリシー設定 |
| 8 | Stage 1 実行 | Claude | `npx tsx --conditions=react-server scripts/salesforce-sandbox-e2e.ts` |
| 9 | 画面確認(取引先・リード・商談・診断・相談予約・取引先責任者)と画面キャプチャ | Claude | Sandboxの画面 |
| 10 | 検証データ削除(必要な場合) | Claude | `... salesforce-sandbox-e2e.ts --cleanup <runId>` |

中止条件: スクリプトが「Sandboxではない」「組織ID不一致」を報告した場合、権限エラーで連携専用ユーザーが書き込めない場合(権限構成を見直して再提案)。

## Stage 1 のシナリオ(`scripts/salesforce-sandbox-e2e.ts`)

1. 無料診断 → リード作成(電話お断りON)・診断履歴
2. 相談CTAクリック×2 → クリック回数・最終日時
3. 相談予約(署名付き医院参照)・同じ通知の再送・日程変更(取消+新規として想定)・取消後に古い確定通知
4. 会員登録 → 取引先・取引先責任者、診断履歴が取引先に紐づく
5. Stripe: トライアル → 有料 → 古いトライアル通知の遅延到着 → 同じ通知の再送 → 解約(受注のまま)
6. 通信失敗 → failed・試行1回 → 再試行で同期完了
7. 同じ医院の同時同期 → 片方は待機、最終的に両方完了
8. 全オブジェクトの件数確認(リード1・取引先1・責任者1・商談1・診断1・相談2)

コンバート済みリードの引継ぎは、Sandboxの画面でリードを取引開始してから追加で確認する(APIからのコンバートは行わない)。
