import "server-only";

export class ArtifactStorageError extends Error {}

/**
 * 生成物(PDF等)バイナリの保存先を抽象化する。MVPでは実装(dbBlobArtifactStorage.ts)が
 * PostgresのBytes列へ直接保存するが、将来医院数が増えた際にS3等のオブジェクトストレージへ
 * 差し替えられるよう、呼び出し側(generateInstructionPdfArtifact.ts等)はこのインターフェース
 * のみに依存する(2026-09-22のユーザー指示)。
 */
export interface ArtifactStorageAdapter {
  /** bytesを保存し、後で読み出すための不透明なstorageRefを返す。 */
  save(input: { key: string; data: Buffer }): Promise<string>;
  /** save()が返したstorageRefからbytesを読み出す。 */
  read(storageRef: string): Promise<Buffer>;
}
