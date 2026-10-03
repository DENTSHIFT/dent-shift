# SMS対象限定ガード: `APP_BASE_URL`誤設定への対策(設計案、未実装)

作成: 2026-10-03 / PO依頼により設計のみ作成。**本番動作は変更していない。コード変更は行っていない。**

## 1. 現状のリスク

`src/server/providers/sms/smsTestSendAllowlist.ts`の`isKnownProductionHost()`は、`APP_BASE_URL`のホスト名が`dentshift.jp`/`www.dentshift.jp`/`app.dentshift.jp`のいずれかであれば本番とみなし、ガード(許可リストとの一致チェック)を完全にスキップする。

**問題**: `dent-shift-test`環境の`APP_BASE_URL`を、作業ミス(コピー&ペースト間違い、Vercelの環境変数設定画面での選択ミス等)で本番ドメインの値に誤設定してしまった場合、`dent-shift-test`であっても「本番」と誤判定され、対象限定ガードが完全に無効化される。これは単一の環境変数(`APP_BASE_URL`)だけに判定を依存していることによる、単一障害点(single point of failure)である。

## 2. 対策案: 2つの独立した信号によるAND判定(既存パターンを踏襲)

このコードベースには既に、Salesforce Sandbox限定スクリプト(`scripts/salesforce-sandbox-e2e.ts`等)で「ホスト名の命名規則チェック」+「組織IDの完全一致チェック」という、**2つの独立した信号が両方一致した場合のみ本番でない(=安全)と判定する**二重ガードのパターンがある。同じ考え方をSMSガードにも適用する。

### 案: `APP_BASE_URL`(人間が設定する値) + `VERCEL_PROJECT_PRODUCTION_URL`(Vercelが自動注入する値)の両方一致を要求

- `VERCEL_PROJECT_PRODUCTION_URL`は、Vercelのビルド/実行時に**Vercel自身が各プロジェクトごとに自動的に注入する**環境変数で、そのVercelプロジェクトの「本番ドメインとして登録されている値」を表す(人間が`.env`やVercelダッシュボードで手動設定する`APP_BASE_URL`とは別の、Vercel管理下の値)。`dent-shift-test`プロジェクトではこの値が`test.dentshift.jp`系(またはそのVercelプロジェクトに割り当てられたドメイン)になり、本番`dentshift-production`プロジェクトでは`dentshift.jp`系になる。人間が`APP_BASE_URL`を誤って本番ドメインの文字列に設定しても、`VERCEL_PROJECT_PRODUCTION_URL`は**そのデプロイが実際に動いているVercelプロジェクト自体の値**であり、誤って書き換わることがない(Vercelが管理するため、アプリ側の環境変数設定ミスの影響を受けない)。
- 新しい判定ロジック(案): `isKnownProductionHost()`は、「`APP_BASE_URL`のホストが本番ドメイン一覧に含まれる」**かつ**「`VERCEL_PROJECT_PRODUCTION_URL`のホストも本番ドメイン一覧に含まれる」の**両方が真の場合のみ**本番とみなす。どちらか一方でも一致しなければ、安全側(非本番、ガード必須)として扱う。
- **効果**: `dent-shift-test`で`APP_BASE_URL`を誤って`dentshift.jp`に設定しても、そのデプロイは依然として`dent-shift-test`というVercelプロジェクト上で動いているため、`VERCEL_PROJECT_PRODUCTION_URL`は`test.dentshift.jp`系のままであり、AND条件が満たされず「非本番」と正しく判定され、ガードは有効のままになる。逆に、本番`dentshift-production`プロジェクトでは両方の値が一致するため、従来通りガードなしで動作する(本番の既存動作は変わらない)。

### 補足: ローカル開発環境での挙動

ローカル開発(`npm run dev`)では`VERCEL_PROJECT_PRODUCTION_URL`自体が存在しない(Vercelのビルド/実行環境でのみ注入される)。この場合は「本番ではない」と判定されるべきであり、上記AND判定ロジックはこれも自然にカバーする(`VERCEL_PROJECT_PRODUCTION_URL`が未設定なら、ANDの片方がfalseになり非本番判定になる)。

## 3. この設計案で解決しないこと(正直に記載)

- `dent-shift-test`プロジェクト自体のVercelダッシュボードで、**プロジェクトの本番ドメイン設定自体を誤って`dentshift.jp`に変更してしまう**という、より深刻な設定ミスまでは防げない(この場合`VERCEL_PROJECT_PRODUCTION_URL`自体が誤った値になるため)。ただし、これは`APP_BASE_URL`という1つのアプリ環境変数の入力ミスよりもはるかに発生しにくく、Vercel側の明示的な操作(ドメイン移管)が必要なため、通常の「環境変数のコピペミス」とはリスクの性質が異なる。
- 完全な自動検知ではなく、あくまで「1つの環境変数の誤設定だけでは本番扱いにならない」という防御層の追加であり、2つの変数が両方誤って本番ドメインに揃ってしまうケースまでは防げない。

## 4. 裏付け確認(2026-10-03、読み取りのみ・設定変更なし)

### 4.1 Vercel公式仕様(`vercel.com/docs/environment-variables/system-environment-variables`)
- `VERCEL_PROJECT_PRODUCTION_URL`: ビルド時・実行時の両方で利用可。「プロジェクトの本番ドメイン名。**最も短い本番カスタムドメイン**を選択し、カスタムドメインが無ければvercel.appドメイン」。**Preview deploymentでも常に設定される**。プロトコル(`https://`)は含まない。
- **重要な前提条件**: システム環境変数は既定で無効であり、プロジェクト設定の「**Enable access to System Environment Variables**」チェックボックスを有効にしないと注入されない。この設計案はこのチェックが両プロジェクトで有効であることに依存する。

### 4.2 実プロジェクト設定(Vercelダッシュボードで閲覧、2026-10-03時点)

| 項目 | `dent-shift-test` | `dent-shift-production` |
|---|---|---|
| System Env Vars有効化 | **オン** | **オン** |
| 本番ドメイン(Production割当) | `test.dentshift.jp`、`dent-shift-test-three.vercel.app` | `dentshift.jp`、`app.dentshift.jp`、`dent-shift-production.vercel.app`(+`www.dentshift.jp`は`dentshift.jp`へ308リダイレクト) |
| 仕様上の`VERCEL_PROJECT_PRODUCTION_URL`期待値 | `test.dentshift.jp`(唯一のカスタムドメイン) | `dentshift.jp`(最短のカスタムドメイン) |

- 両プロジェクトでチェックが有効、かつカスタムドメインが明確に異なる(`test.dentshift.jp` vs `dentshift.jp`)ため、**仕様どおりなら本設計案で両環境を区別できる**。
- `dent-shift-production`は`vercel deploy`(CLI)によるデプロイで、**Git未連携**(Overviewに「Connect Git」ボタン、Production Checklist 2/6)。`docs/PRODUCTION_MIGRATION_PLAN_2026-10-03.md`の「Git未連携、要確認」をダッシュボードで裏付けた。

### 4.3 保留(値を取得できていない点、推測で埋めない)
- 上表の`VERCEL_PROJECT_PRODUCTION_URL`は**公式仕様とドメイン一覧からの推論であり、各デプロイで実際に注入されている値そのものは未観測**。特に`www.dentshift.jp`(308リダイレクト扱い)が「最短カスタムドメイン」の選択対象に含まれるかは仕様文から断定できない(含まれても`dentshift.jp`の方が短いため結論は変わらないが、仕様の読みとしては未確定)。
- 実値の確認方法(提案、未実施): 既存の`src/server/providers/sms/smsLog.ts`は構造化ログに`host`(`APP_BASE_URL`由来)を出しているため、同じログに`VERCEL_PROJECT_PRODUCTION_URL`のホスト名を1項目追加すれば、次回テスト環境デプロイ時に実値を読み取りだけで確認できる(挙動変更なし・秘密値なし)。本番側の実値は本番デプロイのログでしか確認できないため、本番移行時の確認項目に含める。

### 4.4 設計案の残存リスク(追加で判明したもの)
- 本番側で誰かが「Enable access to System Environment Variables」を**オフにした場合**、`VERCEL_PROJECT_PRODUCTION_URL`が未注入になりAND条件が満たされず、**本番が非本番扱いになってSMS送信が全て拒否される**(安全側=fail-closedだが、本番SMS認証が止まる可用性リスク)。実装時は、この状態を検知した際に明示的なエラーログを出す設計にする。

## 5. 実装しない理由・次のステップ

本タスクはPO指示により**設計のみ**とし、コード変更は行っていない。実装する場合は、`isKnownProductionHost()`の判定ロジックを上記AND条件に変更し、`tests/unit/smsTestSendAllowlist.test.ts`に「`APP_BASE_URL`のみ本番ドメイン・`VERCEL_PROJECT_PRODUCTION_URL`は非本番(またはVercel外のローカル環境で未設定)の場合は非本番判定になる」というケースを追加する想定。実装の承認をいただければ着手する。4.3の実値確認を先に行うことを推奨する。
