/**
 * 運営側(Operator)アカウントを個別発行するための手動CLIスクリプト。
 * SECURITY.md「運営側は社内オペレーター」であり、公開の自己サインアップは提供しない方針のため、
 * このスクリプトを人間が明示的にterminalから実行してアカウントを作成する。
 * npm run dev/build/start/test のいずれからも自動実行されない。
 *
 * 使い方:
 *   npx tsx scripts/create-operator.ts --email=ops@example.com --role=admin
 *   (パスワードは対話的に入力させたいところだが、tsx単体では非対応のため
 *    環境変数 OPERATOR_PASSWORD で渡す: OPERATOR_PASSWORD=xxxx npx tsx scripts/create-operator.ts ...)
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/server/auth/password";
import { isOperatorRole } from "@/domain/ops/operatorRole";

async function main() {
  const args = new Map(
    process.argv
      .slice(2)
      .map((arg) => arg.replace(/^--/, "").split("="))
      .map(([key, value]) => [key, value ?? ""])
  );

  const email = args.get("email");
  const role = args.get("role");
  const password = process.env.OPERATOR_PASSWORD;

  if (!email || !role || !password) {
    console.error(
      "使い方: OPERATOR_PASSWORD=xxxx npx tsx scripts/create-operator.ts --email=ops@example.com --role=admin"
    );
    process.exit(1);
  }
  if (!isOperatorRole(role)) {
    console.error(`roleは admin|cs|analyst|finance のいずれかを指定してください(指定値: ${role})`);
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("OPERATOR_PASSWORDは8文字以上にしてください");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const operator = await prisma.operator.create({
      data: { email, passwordHash, role },
    });
    console.log(`Operatorを作成しました: id=${operator.id} email=${operator.email} role=${operator.role}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
