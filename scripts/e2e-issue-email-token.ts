/**
 * 手動E2E専用の一時スクリプト。実行後は使い捨て(コミット不要)。
 * Resendのテストアドレス(delivered@resend.dev)は実受信箱が無いため、メール内リンクを
 * 直接踏めない。本番と同じgenerateEmailVerificationToken()でトークンを発行し、対象Contact
 * のemailVerificationTokenHash/expiresAtへ書き込むことで、/api/auth/verify-emailの
 * 実ロジック(トークン照合・期限チェック・registrationStep遷移)をそのまま検証できるようにする。
 *
 * 使い方: npx tsx --conditions=react-server scripts/e2e-issue-email-token.ts <email>
 */
import { PrismaClient } from "@prisma/client";
import { generateEmailVerificationToken } from "../src/server/auth/emailVerificationToken";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: tsx scripts/e2e-issue-email-token.ts <email>");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const { token, tokenHash, expiresAt } = generateEmailVerificationToken();
  const contact = await prisma.contact.update({
    where: { email },
    data: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt },
  });
  console.log(`contactId=${contact.id}`);
  console.log(`verifyUrl=http://localhost:3000/api/auth/verify-email?token=${token}`);
  await prisma.$disconnect();
}

main();
