import { PrismaClient } from "@prisma/client";

// Next.jsの開発モードでのホットリロード時に接続が増殖しないようにする定番パターン
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
