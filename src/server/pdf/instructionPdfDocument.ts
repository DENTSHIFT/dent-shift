import "server-only";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NOT_AVAILABLE_LABEL, type InstructionPdfContent } from "@/domain/options/instructionPdfContent";

export type { InstructionPdfContent } from "@/domain/options/instructionPdfContent";

// pdf-lib同梱のStandard 14フォント(Helvetica等)は日本語グリフを含まないため、
// Noto Sans JPを同梱しfontkitで埋め込む(制作会社向け指示書は日本語前提のため必須)。
// public/配下に置くことで、Vercel serverless functionのバンドルへ確実に含める。
const JP_FONT_PATH = path.join(process.cwd(), "public/fonts/NotoSansJP-Regular.ttf");

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
  const maxWidth = 495.28;

  const wrapText = (text: string, size: number): string[] => {
    const lines: string[] = [];
    // 日本語は単語区切りがないため、幅超過ごとに折り返す素朴な実装で十分
    // (制作会社向けの実務文書であり、厳密な組版は求められない)。
    let current = "";
    for (const ch of text) {
      const candidate = current + ch;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) lines.push(current);
    return lines.length > 0 ? lines : [""];
  };

  const ensureSpace = (needed: number) => {
    if (cursorY - needed < 50) {
      page = pdf.addPage([595.28, 841.89]);
      cursorY = 800;
    }
  };

  const drawText = (text: string, options: { size?: number } = {}) => {
    const size = options.size ?? 11;
    ensureSpace(size + 10);
    page.drawText(text, { x: marginX, y: cursorY, size, font, color: rgb(0.1, 0.1, 0.1) });
    cursorY -= size + 10;
  };

  const drawField = (label: string, value: string) => {
    ensureSpace(28);
    page.drawText(label, { x: marginX, y: cursorY, size: 11, font, color: rgb(0.15, 0.25, 0.45) });
    cursorY -= 16;
    const lines = wrapText(value || NOT_AVAILABLE_LABEL, 10.5);
    for (const line of lines) {
      ensureSpace(16);
      page.drawText(line, { x: marginX, y: cursorY, size: 10.5, font, color: rgb(0.1, 0.1, 0.1) });
      cursorY -= 15;
    }
    cursorY -= 6;
  };

  drawText("制作会社向け修正指示書", { size: 18 });
  drawField("医院名", content.clinicName);
  drawField("対象URL", content.clinicUrl);
  drawField("Report ID", content.reportId);
  drawField("Version", String(content.version));
  drawField("発行日時", content.generatedAt.toISOString());
  cursorY -= 4;
  drawText(FORBIDDEN_LABEL, { size: 9 });
  cursorY -= 10;

  drawText("改善項目", { size: 14 });
  drawField("タイトル", content.item.title);
  drawField("現状の問題", content.item.currentProblem);
  drawField("改善が必要な理由", content.item.whyItMatters);
  drawField("患者・集患への影響", content.item.patientImpact);
  drawField("具体的な修正手順", content.item.fixSteps);
  drawField("推奨文案", content.item.recommendedCopy);
  drawField("実装条件", content.item.implementationConditions);
  drawField("推奨担当者", content.item.recommendedAssignee);
  drawField("優先度", content.item.priorityLabel);
  drawField("完了条件", content.item.completionCriteria);
  drawField("再診断条件", content.item.remeasurementCriteria);

  return pdf.save();
}
