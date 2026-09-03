import Link from "next/link";
import { requireContact } from "@/server/auth/requireContact";
import { getDiagnosesByClinicId } from "@/server/db/diagnosisRepository";
import { LogoutButton } from "./LogoutButton";

// Step4: 医院側ダッシュボード。requireContact()でセッションを検証し、
// contact.clinicId でスコープした診断のみを取得する(SECURITY.mdのテナント分離方針)。
export default async function DashboardPage() {
  const contact = await requireContact();
  const diagnoses = await getDiagnosesByClinicId(contact.clinicId);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ color: "#2563eb", fontWeight: 600, fontSize: 13 }}>{contact.clinic.name}</p>
          <h1 style={{ fontSize: 22, margin: "4px 0" }}>ダッシュボード</h1>
          <p style={{ color: "#888", fontSize: 13 }}>ログイン中: {contact.email}</p>
        </div>
        <LogoutButton />
      </div>

      <section style={{ marginTop: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16 }}>これまでの診断</h2>
          <Link href="/diagnosis" style={{ fontSize: 13, color: "#2563eb" }}>
            + 新しく診断する
          </Link>
        </div>

        {diagnoses.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14, marginTop: 12 }}>まだ診断結果がありません。</p>
        ) : (
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {diagnoses.map((d) => (
              <Link
                key={d.id}
                href={`/diagnosis/result/${d.id}`}
                style={{
                  display: "block",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: "12px 16px",
                  background: "#fff",
                  textDecoration: "none",
                  color: "#111",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{new Date(d.measuredAt).toLocaleString("ja-JP")}</span>
                  <span style={{ fontWeight: 600 }}>
                    {d.totalStatus === "measured" ? `${d.totalPoints} / 100点` : `${d.totalPoints} / 100点(暫定)`}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
