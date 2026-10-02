export declare const PLAN_PRICES: Record<string, { monthlyYenIncludingTax: number }>;

export declare function checkSmsConfig(
  env: Record<string, string | undefined>
): { providerIsTwilioVerify: boolean; requiredVarsPresent: boolean };

export declare function checkBillingConfig(
  env: Record<string, string | undefined>
): { providerIsStripe: boolean; requiredVarsPresent: boolean };

export declare function verifyStripePrice(
  secretKey: string,
  priceId: string,
  expectedYen: number
): Promise<{
  exists: boolean;
  amountMatches: boolean;
  currencyIsJpy: boolean;
  isMonthly: boolean;
  isLive: boolean;
}>;
