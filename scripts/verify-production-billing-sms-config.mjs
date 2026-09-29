// 2026-09-30追加(PO承認、本番反映前チェックP0)。
//
// 本番のSMS(Twilio)・課金(Stripe)設定が、正しい値になっているかを確認する
// 「一回限りの管理用チェックスクリプト」。新しい公開APIエンドポイントは一切
// 追加しない(このスクリプト自体は実行者のローカル端末で動くだけで、Vercelには
// デプロイしない)。
//
// 【重要な制約(2026-09-30時点でVercel公式ドキュメントにより確認済み、訂正版)】
// このプロジェクトのProduction環境変数は「Sensitive」種別(Vercelコンソール上は
// 「Secret」ロックアイコン表示)で登録されている。Vercel公式ドキュメント
// (https://vercel.com/docs/environment-variables/sensitive-environment-variables)
// によれば、Sensitive変数は「設定後、管理画面(ダッシュボードUI)やCLI(`vercel env
// pull`等)から実際の値を再取得することができない」。`vercel env pull`を実行
// すると、値は実際の値ではなく固定の"[SENSITIVE]"というプレースホルダー文字列に
// 置き換えられて出力される(Vercel CLI Issue #17514で報告されている既知の
// 仕様どおりの挙動)。
//
// これは「実行時にVercelのサーバーレス関数から利用できない」という意味ではない
// (Sensitive変数はデプロイされたコードの実行時には通常どおり復号され、
// process.envから読み取れる)。あくまで「デプロイ後の管理画面・CLIからの
// 事後的な再取得だけができない」という制約であり、両者を混同しない。
//
// そのため、このスクリプトを`vercel env pull`で取得した.envファイルに対して
// 実行しても、SMS_PROVIDER等の値は"[SENSITIVE]"のままとなり、実際の本番設定
// を検証することはできない。この制限は回避しない(Sensitive種別を一時的に
// 変更する、Vercelの管理API経由で別ルートから値を取得する、といった代替手段は
// 一切試みない)。
//
// `vercel dev`がローカル実行時にProductionのSensitive値を実際に復号して
// 利用できるかどうかは未確認であり、確認できていない前提でこの実行案は
// 採用しない。
//
// 実際に本番環境変数の値を検証したい場合、唯一確実な方法は「このチェック
// ロジックをProduction環境にバインドされたコードとして実際にVercel上で
// 実行する」ことになる。これは本番へのコード反映を意味するため、
// Production反映が保留である間は実行できない。
//
// 【このスクリプトの現在の用途】
// 上記の制約により、今は本番の実値検証には使えない。判定ロジック自体は
// ダミーデータ・モック(下記テストファイル参照)で動作確認済みであり、
// Production反映が承認された時点で、このロジックをそのままProduction上の
// コードとして一時的に実行するための準備として用意する。
//
// 【注意】このスクリプトの合格判定は、あくまで「設定値が期待どおりか」の
// 確認であり、実際にSMS配信・決済・Webhook処理が正常に動作することを
// 保証するものではない。
//
// 【設計方針: 秘密値・APIエラー本文を一切出力しない】
// - 環境変数の値そのもの(SMS_PROVIDERの文字列含む)、Stripeの価格ID、
//   Stripe APIキーは一切console.log/console.errorしない。
// - Stripe APIエラー発生時も、エラーオブジェクト全体やレスポンス本文は出力せず、
//   「該当プランの検証に失敗しました」という定型メッセージのみを出す。
// - 出力は各項目のtrue/false判定のみ。

// .mjsからTypeScriptソースを直接importすると構成が壊れやすいため、期待値は
// ここに複製する(唯一の正本はsrc/domain/billing/planPricing.ts。値を変更した
// 場合はこちらも同時に更新すること)。
const PLAN_PRICES = {
  light: { monthlyYenIncludingTax: 14_800 },
  standard: { monthlyYenIncludingTax: 39_800 },
  premium: { monthlyYenIncludingTax: 79_800 },
};

const REQUIRED_SMS_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"];
const REQUIRED_STRIPE_VARS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID_LIGHT",
  "STRIPE_PRICE_ID_STANDARD",
  "STRIPE_PRICE_ID_PREMIUM",
];

function checkSmsConfig(env) {
  const providerOk = env.SMS_PROVIDER === "twilio-verify";
  const varsPresent = REQUIRED_SMS_VARS.every((key) => Boolean(env[key]?.trim()));
  return { providerIsTwilioVerify: providerOk, requiredVarsPresent: varsPresent };
}

function checkBillingConfig(env) {
  const providerOk = env.BILLING_PROVIDER === "stripe";
  const varsPresent = REQUIRED_STRIPE_VARS.every((key) => Boolean(env[key]?.trim()));
  return { providerIsStripe: providerOk, requiredVarsPresent: varsPresent };
}

// StripeのPrice IDを実際にfetchし、金額・通貨・課金周期・livemodeを照合する。
// 値・エラー本文は一切出力しない。true/falseのみ返す。
async function verifyStripePrice(secretKey, priceId, expectedYen) {
  try {
    const res = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      return { exists: false, amountMatches: false, currencyIsJpy: false, isMonthly: false, isLive: false };
    }
    const price = await res.json();
    return {
      exists: true,
      amountMatches: price.unit_amount === expectedYen,
      currencyIsJpy: price.currency === "jpy",
      isMonthly: price.recurring?.interval === "month",
      isLive: price.livemode === true,
    };
  } catch {
    // fetch自体の例外(ネットワークエラー等)。詳細は出力しない。
    return { exists: false, amountMatches: false, currencyIsJpy: false, isMonthly: false, isLive: false };
  }
}

export { PLAN_PRICES, checkSmsConfig, checkBillingConfig, verifyStripePrice };

async function main() {
  const env = process.env;

  console.log("=== SMS設定 ===");
  console.log(checkSmsConfig(env));

  console.log("=== Stripe課金設定(プロバイダー・変数存在) ===");
  const billing = checkBillingConfig(env);
  console.log(billing);

  if (!billing.requiredVarsPresent) {
    console.log("Stripe価格ID検証: 必須変数が揃っていないためスキップします。");
    return;
  }

  console.log("=== Stripe価格ID検証(金額・通貨・課金周期・livemode) ===");
  const plans = [
    { key: "light", envKey: "STRIPE_PRICE_ID_LIGHT" },
    { key: "standard", envKey: "STRIPE_PRICE_ID_STANDARD" },
    { key: "premium", envKey: "STRIPE_PRICE_ID_PREMIUM" },
  ];
  for (const plan of plans) {
    const priceId = env[plan.envKey];
    const expectedYen = PLAN_PRICES[plan.key].monthlyYenIncludingTax;
    const result = await verifyStripePrice(env.STRIPE_SECRET_KEY, priceId, expectedYen);
    console.log(`[${plan.key}]`, result);
  }
}

// テストからimportされた場合はCLI実行しない(直接`node`で実行された場合のみ動く)。
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
