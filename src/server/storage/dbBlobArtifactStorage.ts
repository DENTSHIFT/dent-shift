import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { ArtifactStorageError, type ArtifactStorageAdapter } from "./artifactStorageAdapter";

/**
 * MVP実装: GeneratedArtifact.fileData(Postgres Bytes列)へ直接保存する。
 * keyはGeneratedArtifact.orderId(unique)を使い、storageRefとしてそのままkeyを返す
 * (このアダプタ内だけで完結する詳細であり、呼び出し側はstorageRefの中身を解釈しない)。
 */
export class DbBlobArtifactStorage implements ArtifactStorageAdapter {
  async save(input: { key: string; data: Buffer }): Promise<string> {
    await prisma.generatedArtifact.update({
      where: { orderId: input.key },
      data: { fileData: input.data },
    });
    return input.key;
  }

  async read(storageRef: string): Promise<Buffer> {
    const row = await prisma.generatedArtifact.findUnique({
      where: { orderId: storageRef },
      select: { fileData: true },
    });
    if (!row?.fileData) {
      throw new ArtifactStorageError(`Artifact bytes not found for storageRef=${storageRef}.`);
    }
    return Buffer.from(row.fileData);
  }
}

let singleton: ArtifactStorageAdapter | null = null;

/**
 * 現在のアダプタを解決する。将来S3等へ切り替える際は、ここを環境変数分岐に
 * 置き換えるだけで呼び出し側(service/route)の変更は不要にする。
 */
export function getArtifactStorageAdapter(): ArtifactStorageAdapter {
  if (!singleton) singleton = new DbBlobArtifactStorage();
  return singleton;
}
