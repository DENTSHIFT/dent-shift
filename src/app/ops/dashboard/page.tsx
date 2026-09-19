import { requireOperator } from "@/server/auth/requireOperator";
import { prisma } from "@/server/db/prismaClient";
import { recordAuditLog } from "@/server/db/auditLogRepository";

const NAVY = "#0F1B2D";
const BORDER = "#E5E9F0";

/**
 * 運営側ダッシュボード(最小構成)。クロステナントで医院一覧・最新契約状態を参照できる。
 * SECURITY.md「運営側はクロステナント参照が必要だが、必ず監査ログを残す専用経路を経由する」
 * に基づき、この参照自体を毎回AuditLogへ記録する。
 */
export default async function OpsDashboardPage() {
  const operator = await requireOperator();

  const clinics = await prisma.clinic.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { diagnoses: true, contacts: true } },
    },
  });

  await recordAuditLog({
    operatorId: operator.id,
    action: "ops_view_clinics_list",
    targetType: "Clinic",
    metadata: { resultCount: clinics.length },
  }).catch((error) => {
    console.error("[ops/dashboard] audit log recording failed:", error);
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22, color: NAVY }}>運営ダッシュボード</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
        {operator.email}({operator.role})としてログイン中。医院一覧(最新50件)。
      </p>

      <table style={{ width: "100%", marginTop: 24, borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: `2px solid ${BORDER}` }}>
            <th style={{ padding: "8px 4px" }}>医院名</th>
            <th style={{ padding: "8px 4px" }}>URL</th>
            <th style={{ padding: "8px 4px" }}>診断回数</th>
            <th style={{ padding: "8px 4px" }}>会員数</th>
            <th style={{ padding: "8px 4px" }}>契約状態</th>
            <th style={{ padding: "8px 4px" }}>登録日</th>
          </tr>
        </thead>
        <tbody>
          {clinics.map((clinic) => (
            <tr key={clinic.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <td style={{ padding: "8px 4px" }}>{clinic.name}</td>
              <td style={{ padding: "8px 4px", color: "#6b7280" }}>{clinic.url}</td>
              <td style={{ padding: "8px 4px" }}>{clinic._count.diagnoses}</td>
              <td style={{ padding: "8px 4px" }}>{clinic._count.contacts}</td>
              <td style={{ padding: "8px 4px" }}>{clinic.subscriptions[0]?.status ?? "未契約"}</td>
              <td style={{ padding: "8px 4px", color: "#6b7280" }}>
                {clinic.createdAt.toISOString().slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
