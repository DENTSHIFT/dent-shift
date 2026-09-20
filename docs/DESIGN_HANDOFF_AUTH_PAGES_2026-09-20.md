# DENT SHIFT — 認証系画面(ログイン・会員登録・SMS認証) UI調整 引き継ぎ指示書

作成日: 2026-09-20。作業対象: 医院向け認証系3画面のみ。

- `/login`(`src/app/login/page.tsx`, `src/app/login/LoginForm.tsx`)
- `/signup`(`src/app/signup/page.tsx`, `src/app/signup/SignupForm.tsx`)
- `/verify-phone`(`src/app/verify-phone/page.tsx`, `src/app/verify-phone/VerifyPhoneForm.tsx`)

他の画面(ダッシュボード・診断結果・opsポータル・プラン比較等)は対象外。

宛先: この指示書を渡された別のAIコーディングエージェント(GPT/Codex等)。過去3回、同種のUI調整を実施済み(診断結果画面: コミット`0e25313`、ダッシュボード: `6e850af`、opsポータル: `793da9a`)。同じ進め方・同じ制約方針を踏襲すること。

## 0. 最初に必ず確認するもの

1. `docs/ui/DESIGN_SYSTEM.md`
2. `public/brand/logo/README_使用ガイド.md`
3. **本書1章(今回は自前のリファレンス実装がある)**

## 1. 重要事項: 今回は外部の正本画像ではなく、同一リポジトリ内の実装を参照する

この3画面には`design/reference/`配下に専用のデザイン画像が無い。しかし、**直前のタスクでopsポータルのログイン画面(`/ops/login`)を同種のブランド付きカードレイアウトへ調整済みであり、これがそのまま流用できる正本になる。**

- 参照コンポーネント: `src/app/ops/login/page.tsx`、`src/app/ops/login/OpsLoginForm.tsx`
- 参照スタイル: `src/app/ops/ops.module.css`内の`.loginShell` / `.loginCard` / `.loginBrand` / `.loginLogo` / `.loginTitle` / `.loginDescription` / `.loginForm` / `.field` / `.fieldLabel` / `.input` / `.loginButton` / `.error`クラス一式

`/login`・`/signup`・`/verify-phone`は、このopsログインカードと**ほぼ同一の構造**(ロゴ付きカード→見出し→説明文→フォーム)にすればよい。ただし医院向け画面なので、opsの「管理者用」バッジに相当するものは付けない(通常のDENT SHIFTロゴのみでよい)。

## 2. 現状の実装ファイル

- `src/app/login/page.tsx` / `src/app/login/LoginForm.tsx`: 現状、素のインラインstyle・ロゴなし・カードなし(opsポータルの調整前と同じ状態)。
- `src/app/signup/page.tsx` / `src/app/signup/SignupForm.tsx`: 同上。`clinicId`の有無で説明文が変わる分岐は維持すること。
- `src/app/verify-phone/page.tsx` / `src/app/verify-phone/VerifyPhoneForm.tsx`: SMS送信→コード確認の2ステップUI。現状インラインstyleで最低限実装済み。**「(営業電話は一切致しません)」という文言(ラベル内)と、携帯電話番号のみ許可する旨の注記文は、内容を変更せず見た目だけ調整すること(1つ前のセッションでユーザーから明示指示があった重要文言)。**

## 3. 実装方針

- `src/app/login/`・`src/app/signup/`・`src/app/verify-phone/`それぞれに、ops側と同様のCSS Modulesファイル(`login.module.css`等、または3画面で共有する`auth.module.css`を1つ作ってもよい)を新設し、`ops.module.css`の`.loginShell`/`.loginCard`系のスタイルをベースに流用する。
- ロゴ画像は`/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png`を使う(ops側と同じ)。
- 各ページの既存の文言・分岐ロジック・`<Field>`ヘルパー的な構造は維持し、**見た目(スタイルの当て方)だけ**をops/loginと揃える。
- `/verify-phone`はSMS送信後にステップが切り替わる(`enter-phone` → `enter-code`)。両ステップともカードデザインを維持すること。

## 4. 厳守事項

- `src/server/**`・`src/domain/**`・Prisma schema・migrationは一切変更しないこと。
- 各フォームが呼び出しているAPI(`/api/auth/login`、`/api/auth/signup`、`/api/auth/phone/send`、`/api/auth/phone/verify`)のエンドポイント・リクエストボディを変更しないこと。
- 「(営業電話は一切致しません)」等の既存文言を削除・変更・弱体化しないこと。
- 新しいnpmパッケージを追加しないこと。
- ブランドロゴの再生成・変形・色変更をしないこと。
- モバイル対応を維持すること(`ops.module.css`の`@media (max-width: 700px)`ブロックのモバイル調整も参考にすること)。

## 5. 動作確認の手順

```bash
cd /Users/masatokimura/Documents/dent-shift
npm run dev
```

**注意**: `localhost:3000`が過去に別プロジェクトのdevサーバーと衝突したことがある。`http://127.0.0.1:3000`のようにIPv4を明示してアクセスするか、事前に`lsof -nP -iTCP:3000 -sTCP:LISTEN`で確認すること。`pkill`で無関係なプロセスを巻き込まないよう注意。

`/signup`から新規登録すると`/verify-phone`へ遷移する(SMS認証が必須ステップのため)。確認後は必ず作成したContact/Session/Clinicを削除すること。

```js
// node -e "..." で実行する例
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const contact = await prisma.contact.findUnique({ where: { email: 'your-test@example.com' } });
if (contact) {
  await prisma.session.deleteMany({ where: { contactId: contact.id } });
  await prisma.contact.delete({ where: { id: contact.id } });
  await prisma.clinic.delete({ where: { id: contact.clinicId } }).catch(() => {});
}
```

`/login`の確認は、上記で作成したテストアカウントでログインしてみればよい(削除前に)。

## 6. 完了報告に含めること

- 作業完了時に必ず以下をすべて成功させること:
  ```bash
  npm run test
  npx tsc --noEmit -p tsconfig.json
  npm run lint
  npm run build
  ```
- 3画面それぞれの変更前後のスクリーンショット(PC・モバイル)
- 変更ファイル一覧・差分要約
- API呼び出し(エンドポイント・リクエストボディ)が変更されていないことの明示的な確認
- 「営業電話は一切致しません」等の既存文言が維持されていることの確認
- 作成したテストアカウント(Contact/Session/Clinic)を削除したことの確認
