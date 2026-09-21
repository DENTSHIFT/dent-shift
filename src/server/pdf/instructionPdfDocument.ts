import "server-only";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";

// pdf-lib同梱のStandard 14フォント(Helvetica等)は日本語グリフを含まないため、
// Noto Sans JPを同梱しfontkitで埋め込む(制作会社向け指示書は日本語前提のため必須)。
// public/配下に置くことで、Vercel serverless functionのバンドルへ確実に含める。
const JP_FONT_PATH = path.join(process.cwd(), "public/fonts/NotoSansJP-Regular.ttf");

/**
 * 制作会社向け修正指示書PDFの入力。ホワイトリスト方式で明示したフィールドのみを
 * 受け取り、呼び出し側がDiagnosis等から自由なオブジェクトを渡せないようにする
 * (患者個人情報の混入防止。仕様書Ver1■)。Phase4前半はモック内容で固定する。
 */
export interface InstructionPdfContent {
  clinicName: string;
  reportVersion: number;
  generatedAt: Date;
  improvementItems: readonly { title: string; detail: string }[];
}

const FORBIDDEN_LABEL = "この指示書には患者の個人情報は含まれません。";

/**
 * pdf-libでPDFバイト列を生成する(パスワード保護前の平文PDF)。
 * ネイティブ依存なし・Vercel serverless上で安定動作するライブラリのみを使う。
 */
export async function buildInstructionPdfDocument(
  content: InstructionPdfContent
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await readFile(JP_FONT_PATH);
  const font = await pdf.embedFont(fontBytes, { subset: true });

  let page = pdf.addPage([595.28, 841.89]); // A4
  let cursorY = 800;
  const marginX = 50;

  const drawText = (text: string, options: { size?: number } = {}) => {
    const size = options.size ?? 11;
    if (cursorY < 60) {
      page = pdf.addPage([595.28, 841.89]);
      cursorY = 800;
    }
    page.drawText(text, {
      x: marginX,
      y: cursorY,
      size,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= size + 10;
  };

  drawText("制作会社向け修正指示書", { size: 18 });
  drawText(`医院名: ${content.clinicName}`);
  drawText(`診断バージョン: v${content.reportVersion}`);
  drawText(`作成日時: ${content.generatedAt.toISOString()}`);
  cursorY -= 10;
  drawText(FORBIDDEN_LABEL, { size: 9 });
  cursorY -= 10;

  drawText("改善項目一覧", { size: 14 });
  for (const item of content.improvementItems) {
    drawText(`・${item.title}`, { size: 11 });
    drawText(item.detail, { size: 10 });
    cursorY -= 6;
  }

  return pdf.save();
}
