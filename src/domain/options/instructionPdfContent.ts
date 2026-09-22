/** データが存在しない項目に使う表示文言。AIによる架空の補完は行わない(仕様書Ver1■)。 */
export const NOT_AVAILABLE_LABEL = "要確認(診断データからは判定できません)";

/**
 * 制作会社向け修正指示書PDFの入力。ホワイトリスト方式で明示したフィールドのみを
 * 受け取り、呼び出し側がDiagnosis等から自由なオブジェクトを渡せないようにする
 * (患者個人情報の混入防止。仕様書Ver1■)。存在しないデータはAIで補完せず、
 * 呼び出し側がNOT_AVAILABLE_LABELを設定する(PDF描画側は受け取った文字列を
 * そのまま描画するのみ)。
 */
export interface InstructionPdfContent {
  clinicName: string;
  clinicUrl: string;
  reportId: string;
  version: number;
  generatedAt: Date;
  item: {
    title: string;
    currentProblem: string;
    whyItMatters: string;
    patientImpact: string;
    fixSteps: string;
    recommendedCopy: string;
    implementationConditions: string;
    recommendedAssignee: string;
    priorityLabel: string;
    completionCriteria: string;
    remeasurementCriteria: string;
  };
}
