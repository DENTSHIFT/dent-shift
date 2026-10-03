# ブランチ差分分類整理: `feature/salesforce-crm-sync` vs `master` (2026-10-03)

対象: `master..feature/salesforce-crm-sync`（71コミット、283ファイル、+19786/-994行）

本資料は読み取り専用調査（`git log`/`git diff`/`git show`）に基づく分類整理であり、履歴の書き換えや既存コミットの削除・変更は行っていない。

---

## 1. 4分類の概要

| カテゴリ | コミット数(概算) | ファイル数(概算) | 変更行数(概算) |
|---|---|---|---|
| Salesforce | 約28 | 128 | +8725/-312 |
| TimeRex | 約7(うち主要1件はSalesforceコミットに同梱) | 9(単独集計分) | +626/-74 |
| 認証・メール | 約4〜6(他カテゴリと一部重複) | 3 | +144/-2 |
| その他 | 約30 | 残余 | 残余 |

注: 複数カテゴリにまたがるコミットがあるため、単純合計は総数と一致しない。

### 1-1. Salesforce（約28コミット）

`321c2c2, b63d53f, 5cf497c, 545e8ce, 236b682, 5cb4067, 5e20d80, c072348, 207a85a, e4449ca, 25ddeb8, d7cdd8a, 6d7fcc6, fc3fdfe, 678c226, 0460bdb, c7435ca, 9dc3fbf, e8b08cf, 5484e4d, b812683, 6ca38c9（※下記参照）, ad9452b, 70a0c4f（※TimeRexにも言及）, b2f73de, 9adbe6c`

主な実装パス:
- `src/server/providers/salesforce/salesforceClient.ts`
- `src/server/services/salesforceSync.ts`
- `src/server/services/notifySalesforceSyncFailure.ts`
- `src/server/config/salesforceConfig.ts`
- `src/domain/integration/salesforceCrmMapping.ts`
- `src/app/api/internal/salesforce`, `src/app/api/ops/salesforce-connection-check`
- `salesforce/force-app/...`（Salesforceメタデータ）
- `scripts/salesforce-*.mjs|ts`
- `docs/SALESFORCE_*.md`
- `prisma/migrations/20261001120000_salesforce_crm_sync`

### 1-2. TimeRex（約7コミット）

`8de3439, 583316c, 707a724, 1249462, 2a3c966, 65eda9e, 6ca38c9（Salesforceコミットに同梱）`

主な実装パス:
- `src/app/api/webhooks/timerex/route.ts`
- `src/components/timerex/TimeRexEmbed.tsx`
- `src/components/timerex/timerexWidgetParams.ts`
- `src/domain/integration/timerexWebhook.ts`
- `src/server/config/timerexWebhookConfig.ts`
- `src/server/services/timerexBookings.ts`
- `src/server/integration/bookingRef.ts`
- `docs/TIMEREX_URL_PARAMS_INVESTIGATION_2026-10-03.md`

### 1-3. 認証・メール（約4〜6コミット、他カテゴリと重複あり）

`6905120, 6f042a0, f11a3bd, 6d583a6（UTM永続化+IntegrationEvent、認証メールリンクにも影響）, 403c264・64bf761（EMAIL_LINK_ALLOWED_HOSTS等を含むが主眼は診断APIの冪等性/レート制限）`

対象ファイル: `src/app/api/auth/phone/verify/route.ts`, `src/app/api/auth/verify-email/route.ts`, `tests/unit/verifyProductionBillingSmsConfig.test.ts`

補足: 認証系の主要機能（サインアップ、SMS OTP、メール確認、パスワードリセットの本体実装）は本ブランチではなく**master側に既にマージ済み**（例: migration `20260919211741_auth_sms_email_salesforce` はmasterの`3ac21ff`由来）。本ブランチにおける認証系変更は、既存機能への細かい修正（`6905120`「already-verified wording」修正、`6f042a0`「already-verified session」修正等）にとどまる。

### 1-4. その他（約30コミット）

`95269ac, 6585a33, cad8bf8, 749105f, 61a00c2, 9047e12, 44ae911, 26d62b7, cc5fe6a, 34d6f8f, 6b9a2da, 53e6c79, c453506, 8c21296, 8b3ac47, 26ce9c9, b683c6b, 844d6f9, 6c72a4e, 2df0890, 01e1ab6, dd2e445, bec38e3, 5859e1c, 1c05651, 7ac7a35, 72022fb, ad976f9, 2f802e1, cd399bc, 7501e92, 0539f49`

内容: LP文言・特商法表記修正、プラン配色・レイアウト調整、画像配信方式変更、SMS/Stripe設定確認用ワンオフスクリプト、診断フォームの冪等性・レート制限、AIOスコアリング（OpenAI実測）、UTM計測、404ページ追加、ログインCTA追加など。

### 1-5. 複数カテゴリにまたがるコミット

| コミット | 内容 | またがるカテゴリ |
|---|---|---|
| `6ca38c9` | feat(crm): sync clinics to Salesforce（リード/アカウント/コンタクト/商談upsert）+ TimeRex webhook全面書き換え + Stripe billing webhook変更 + ダッシュボード/オンボーディング画面 + `.env.example`/`vitest.config.ts` | Salesforce / TimeRex / Billing（その他） |
| `9dc3fbf` | chore(salesforce): Account画面完成（Sandbox限定） + `.claude/launch.json`変更が同梱 | Salesforce / 開発環境設定 |
| `e8b08cf` | chore(salesforce): Stage1 sandbox runbook + `.gitignore`変更同梱 | Salesforce / その他（軽微） |
| `8de3439` / `70a0c4f` | ドキュメントでSalesforceとTimeRex両方に言及 | Salesforce / TimeRex |
| `403c264` / `64bf761` | 診断API冪等性強化が主目的だが`EMAIL_LINK_ALLOWED_HOSTS`追加等認証メールリンクにも影響 | その他 / 認証・メール |
| `bec38e3` / `6d583a6` | 「その他」寄り機能（CSV出力・UTM計測）だが`IntegrationEvent`（Salesforce連携中核テーブル）を直接操作 | その他 / Salesforce |

---

## 2. 混入の指摘

### 2-1. `.claude/launch.json`（最重要）

- コミット `9dc3fbf`（Salesforce Sandbox作業コミット）で、本来無関係な開発環境設定ファイル `.claude/launch.json` が変更され、新規エントリ `dent-shift-sf` が追加された。
- その際、既存の `dent-shift` エントリの `runtimeArgs` が複数行フォーマットに変わり、ファイル末尾の改行が失われるという**副作用的な改変**が発生した。
- 直近のコミット `bacdf3a`「chore(launch): restore original formatting of the pre-existing dent-shift entry」でこの副作用を修正し、`dent-shift` エントリのフォーマット（`["run", "dev"]` の1行表記、末尾改行）を元通りに復元済み。コミットメッセージ自体が「意図しない副作用」であったことを明記している。
- 現状（最終形）: `dent-shift`（既存、`npm run dev`、port 3000）と `dent-shift-sf`（新規、`npx next dev -p 3100`、port 3100）の2エントリが共存。新規エントリ追加自体は意図的だが、**それがSalesforce機能実装コミットに無関係な形で同梱された点**が典型的な混入である。詳細は第5節参照。

### 2-2. その他の混入

- `e8b08cf`（Salesforce runbookコミット）に`.gitignore`変更が同梱（軽微）。
- `6ca38c9`はSalesforce本体機能と無関係なTimeRex全面書き換え・Stripe billing webhook変更を大量に含む、最大の混入コミット。
- `docs/SALESFORCE_*.md`、`docs/production-plan`系ドキュメントがSalesforce・SMS・TimeRexの論点を横断して記述しており、ドキュメント単位での分離が難しい。

---

## 3. 依存関係

- **Prismaマイグレーション**: 本ブランチで`prisma/`配下を変更したのは4コミット: `6d583a6`（UTM列+IntegrationEvent.nextRetryAt追加）、`403c264`（DiagnosisRateLimitState/DiagnosisIdempotencyLock追加）、`64bf761`（Subscription/DiagnosisRateLimit列追加）、`6ca38c9`（Salesforce CRM sync用マイグレーション`20261001120000_salesforce_crm_sync`、CrmSyncLockテーブル等）。マイグレーションファイル自体は各コミットで分離されており、同一ファイル内に複数カテゴリが同居する直接の競合はない。ただし適用順序はコミット順（`6d583a6`→`403c264`→`64bf761`→`6ca38c9`）であり、Salesforceマイグレーションを単独PRに切り出す場合は前3つ（「その他」カテゴリの診断機能）のマイグレーションが先に適用されている前提になる。
- **コード依存**: `6ca38c9`がSalesforce機能のコア（`salesforceSync.ts`等）とTimeRex webhook書き換え・billing webhook変更を同一コミットで導入しているため、**Salesforce機能をこのコミット抜きで分離することはほぼ不可能**。TimeRexの`bookingRef.ts`・`timerexBookings.ts`はSalesforce連携（`CrmSyncLock`、予約の紐付け）のために新設されており、Salesforce側ドメインロジックから参照されている可能性が高い。
- **共有データモデル**: `IntegrationEvent`テーブル（master由来）は認証系イベント（email_verified, phone_verified等）とSalesforce連携イベントの両方を格納しており、`6d583a6`・`bec38e3`はこのテーブルへの変更のため認証・その他・Salesforceの3カテゴリが同じデータモデルに依存する。

---

## 4. 分割可能性の評価

> **訂正**: 「同一コミットに混在している」こと自体は、分割できない理由にはならない。コミットを手動で分割（`git rebase -i`や`git add -p`でのdiff単位の切り出し等）すれば、コミット単位では原理的にほぼどんな変更も分離できる。以下では「コミット単位の分離が(作業コストとして)困難なもの」と「コード依存上も分離が困難なもの(切り出した場合に実行時エラーになる・意味が通らなくなるもの)」を区別して記載する。

- **Salesforce単独PR**: `6ca38c9`はコミット単位では手動で分割可能(diffをSalesforce部分/TimeRex部分/Billing部分に手で切り分けることは技術的に可能)。ただし**コード依存上**、Salesforce側のドメインロジック(`CrmSyncLock`、予約の医院紐付け)がこのコミットで新設されたTimeRexの`bookingRef.ts`・`timerexBookings.ts`を参照している可能性が高く、依存関係を解きほぐす追加実装(インターフェースの分離等)なしにそのまま2つのコミットへ機械的に分割すると、中間状態でビルドが壊れる・テストが通らなくなるリスクがある。つまり「コミット単位の分離」は手間はかかるが可能、「依存を壊さない分離」にはコード側の追加整理が必要、という二段階の課題がある。それ以外のSalesforce専用コミット(Sandbox検証・ドキュメント・運用スクリプト類、約25コミット)は依存が薄く、コミット単位の切り出しだけで分離可能。
- **TimeRex単独PR**: `2a3c966`・`65eda9e`（UIブレークポイント調整）は完全に独立して切り出せる。`583316c`・`707a724`・`1249462`は`6ca38c9`で新設されたwidget params/bookingRefに依存するため、`6ca38c9`を含むPRより後にしか成立しない。
- **認証・メールPR**: 本ブランチの認証系変更は小粒（3ファイル）で独立性が高く、単独PR化は容易。ただし`403c264`/`64bf761`のEMAIL_LINK_ALLOWED_HOSTS部分は診断API強化コミットに同梱されており、分離するにはコミットの手動分割（cherry-pick+diff編集）が必要。
- **その他PR**: LP文言・デザイン調整系（約20コミット）は完全に独立しており即座に分離可能。診断API冪等性強化（`403c264`, `64bf761`）とAIOスコアリング系（`01e1ab6`, `1c05651`等）はPrismaマイグレーションを含むため、Salesforceマイグレーション（`6ca38c9`）より前に適用する必要がある（時系列通り）。

**分割の障害まとめ(コミット単位の分離コストと、コード依存上の分離困難さを区別)**:
1. `6ca38c9`: コミット単位の手動分割は可能(diffの切り分け自体は可能)だが、Salesforce↔TimeRexのコード依存(上記参照)があるため、依存を壊さずに分離するには追加のコード整理が必要。
2. `.claude/launch.json`: これは純粋に「作業コミットへの混入」であり、コード依存は一切ない。単独コミットとして切り出す/除去するのにコスト上の障害はない(第5節参照)。
3. `IntegrationEvent`という共有データモデルを認証イベントとSalesforceイベント双方が使っている点は、**コード依存上の分離困難さ**(テーブル定義・マイグレーションが共有されているため、片方だけを別PRに出すとマイグレーション順序の調整が必要)。
4. ドキュメントファイルが複数論点を横断して記述している点は、コード依存ではなく**編集上の手間**の問題であり、分割自体を妨げるものではない。

---

## 5. `.claude/launch.json` について

### 5-1. 新旧エントリの比較

| 項目 | `dent-shift`（既存） | `dent-shift-sf`（新規） |
|---|---|---|
| 追加時期 | 既存（認証系実装の初期コミット由来） | `9dc3fbf`（Salesforce Sandbox Account画面実装コミットに同梱） |
| runtimeExecutable | `npm` | `npx` |
| runtimeArgs | `["run", "dev"]` | `["next", "dev", "-p", "3100"]` |
| port | 3000 | 3100 |
| 用途 | 通常のdent-shift開発サーバー（デフォルト`npm run dev`） | 別ポート(3100)で立ち上げる2本目のNext.js開発サーバー |

### 5-2. 新エントリの必要性

`9dc3fbf`のコミットメッセージ・diffによれば、`scripts/salesforce-layout-metadata-deploy.mjs`・`salesforce-flexipage-metadata-deploy.mjs`等を使い、SalesforceのAccount画面に新しい「DENT SHIFT」タブを追加・検証する作業が行われている。また一連のSalesforce Sandbox検証コミット群（`e8b08cf`のrunbook、`5484e4d`のE2Eランナー等）では、本番/Sandbox接続先を切り替えながらの検証が必要とされる。

`dent-shift-sf`はポート3100で別プロセスとして起動することで、**メインのdent-shift開発サーバー（ポート3000、通常設定）と並行して、Salesforce連携のSandbox検証用サーバーを同時に立ち上げられるようにする**ための開発環境エントリと考えられる（例: 本体を3000で通常開発しつつ、3100で`/api/ops/salesforce-connection-check`等のSandbox接続確認ルートを別セッションで操作する用途）。ポート分離以外の設定差分（.env切り替え等）は本調査のdiff範囲内では確認できなかった。

### 5-3. 結論(訂正)

- **訂正**: `dent-shift-sf`エントリは`.claude/launch.json`というローカル開発用の設定ファイル(エディタ/ツールがdevサーバーを起動するための補助設定)であり、本番ビルド・本番デプロイ・アプリの実行時動作には一切影響しない。したがって「ローカル検証用サーバー設定である」こと自体は、**今回のリリースに含める必要があるという結論の根拠にはならない**。「Salesforce Sandbox検証に便利」という開発体験上のメリットはあるが、**本番稼働の必須要件ではない**。
- ただし本来は独立したコミット（例: "chore(launch): add dent-shift-sf dev server entry"）にすべきところ、Salesforce機能実装コミット`9dc3fbf`に無関係な形で同梱されてしまった。さらにその際に既存`dent-shift`エントリのフォーマットを意図せず変更してしまい、後続コミット`bacdf3a`での手戻り修正が必要になった。
- **対応方針**: 既存の`dent-shift`エントリはユーザーの元の変更（フォーマット含む）のまま保持されており（`bacdf3a`で復元済み）、これを削除・変更することはしない。新規`dent-shift-sf`エントリも、本番稼働に必須ではないという位置づけのまま、特に除去する理由もないためそのまま残す(開発用の便利設定として)。履歴の書き換えや当該コミットの削除は行わない。今後同種の作業を行う際は、開発環境設定ファイルの変更は機能実装コミットと分離したコミットにすることを推奨する。

---

## 6. 総括(訂正)

4分類に明確に分けられる部分（その他カテゴリの約20コミット、TimeRexのUI調整2コミット、認証系の小規模修正3コミット）は独立PR化が容易である。Salesforce連携の中核コミット`6ca38c9`は、**コミット単位での手動分割自体は可能**だが、TimeRexの`bookingRef.ts`等への実コード依存があるため、依存を壊さずに分離するには追加のコード整理コストがかかる。これを踏まえると、最低でも「Salesforce+TimeRex+Billing統合PR」+「認証・メール修正PR」+「その他独立修正群PR」の3系統への再編が、コストと分離効果のバランスとして現実的な落としどころと考えられる(ただし、現時点でブランチの再編・履歴の書き換えは行っていない)。

`.claude/launch.json`の`dent-shift-sf`エントリは、本番ビルド・本番稼働には一切影響しないローカル開発用設定であり、「含める必要がある」ものではなく「本番稼働の必須要件ではないが、既存のユーザー変更を保持したまま残している」設定である。削除・変更は行っていない。
