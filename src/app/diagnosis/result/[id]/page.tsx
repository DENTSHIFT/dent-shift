import { notFound } from "next/navigation";
import { getDiagnosisById } from "@/server/db/diagnosisRepository";
import type { DomainScore } from "@/domain/diagnosis/types";
import type { PatientQuestionResult } from "@/domain/competitor/types";
import type { ImprovementCandidate } from "@/domain/improvement-task/types";

const STATUS_LABEL: Record<PatientQuestionResult["status"], string> = {
  win: "勝ち",
  close: "拮抗",
  lose: "負け",
  insufficient_data: "データ不足",
};

const STATUS_COLOR: Record<PatientQuestionResult["status"], string> = {
  win: "#16a34a",
  close: "#d97706",
  lose: "#dc2626",
  insufficient_data: "#6b7280",
};

export default async function DiagnosisResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const diagnosis = await getDiagnosisById(id);
  if (!diagnosis) notFound();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      <DisclaimerBanner text={diagnosis.dataDisclaimer} />

      <h1 style={{ fontSize: 22, marginTop: 24 }}>{diagnosis.clinicName} の診断結果</h1>
      <p style={{ color: "#888", fontSize: 13 }}>
        測定日時: {new Date(diagnosis.measuredAt).toLocaleString("ja-JP")} / {diagnosis.clinicUrl}
      </p>

      <Section title="総合集患スコア">
        <p style={{ fontSize: 32, fontWeight: 700 }}>
          {diagnosis.totalPoints}
          <span style={{ fontSize: 16, color: "#888" }}> / 100点</span>
        </p>
        {diagnosis.totalStatus !== "measured" && (
          <p style={{ fontSize: 13, color: "#d97706" }}>
            {diagnosis.totalStatus === "partial"
              ? "一部の領域が未測定のため、暫定スコアです(未測定分は0点として扱っていません)"
              : "一部推定値を含むスコアです"}
          </p>
        )}
      </Section>

      <Section title="6領域スコア">
        <div style={{ display: "grid", gap: 8 }}>
          {(diagnosis.scoreBreakdown.domains as DomainScore[]).map((d) => (
            <DomainRow key={d.domain} score={d} />
          ))}
        </div>
      </Section>

      <Section title="患者質問別の勝敗">
        <div style={{ display: "grid", gap: 8 }}>
          {(diagnosis.questionResults as PatientQuestionResult[]).map((q) => (
            <div
              key={q.question}
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 12,
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{q.question}</span>
                <span style={{ color: STATUS_COLOR[q.status], fontWeight: 600 }}>
                  {STATUS_LABEL[q.status]}
                </span>
              </div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "#888", fontSize: 12 }}>
                {q.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="改善TOP3">
        <div style={{ display: "grid", gap: 12 }}>
          {(diagnosis.topImprovements as ImprovementCandidate[]).map((task, i) => (
            <div
              key={i}
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 16,
                background: "#fff",
              }}
            >
              <p style={{ fontWeight: 600 }}>
                {i + 1}. {task.title}
              </p>
              <p style={{ fontSize: 13, color: "#555" }}>検出事実: {task.detectedFact}</p>
              <p style={{ fontSize: 13, color: "#555" }}>影響: {task.patientImpact}</p>
              <p style={{ fontSize: 13, color: "#555" }}>推奨アクション: {task.recommendedAction}</p>
              <p style={{ fontSize: 12, color: "#888" }}>
                インパクト: {task.impact} / 確度: {task.confidence} / 緊急性: {task.urgency}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <p style={{ fontSize: 12, color: "#aaa", marginTop: 40 }}>
        本レポートはAIによる参考情報です。医療広告・法的判断についての最終判断は医院または専門家が行ってください。
      </p>
    </main>
  );
}

function DisclaimerBanner({ text }: { text: string }) {
  return (
    <div
      style={{
        background: "#fef3c7",
        border: "1px solid #f59e0b",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        color: "#92400e",
      }}
    >
      {text}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function DomainRow({ score }: { score: DomainScore }) {
  const isUnavailable = score.status === "unavailable";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        border: "1px solid #eee",
        borderRadius: 8,
        padding: "10px 14px",
        background: "#fff",
      }}
    >
      <span>{score.domain}</span>
      <span style={{ color: isUnavailable ? "#9ca3af" : "#111" }}>
        {isUnavailable ? "取得不能" : `${score.points} / ${score.maxPoints}点`}
        {score.status === "estimated" && (
          <span style={{ color: "#d97706", fontSize: 11, marginLeft: 6 }}>(推定)</span>
        )}
      </span>
    </div>
  );
}
