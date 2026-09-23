import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContact } from "@/server/auth/requireContact";
import { getOptionOrderById } from "@/server/db/optionOrderRepository";
import { InstructionPdfStatusPanel } from "./InstructionPdfStatusPanel";

const NAVY = "#0F1B2D";
const BLUE = "#2563EB";
const BG = "#F5F7FA";
const BORDER = "#E5E9F0";
const MUTED = "#6B7280";

export default async function InstructionPdfStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; checkout?: string }>;
}) {
  const contact = await requireContact({ next: "/dashboard/options/instruction-pdf" });
  const { orderId, checkout } = await searchParams;

  if (!orderId) notFound();
  const order = await getOptionOrderById(orderId);
  if (!order || order.clinicId !== contact.clinicId) notFound();

  return (
    <main style={{ minHeight: "100vh", background: BG, padding: "40px 16px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <Link href="/dashboard" style={{ fontSize: 13, color: BLUE, textDecoration: "none" }}>
          ← ダッシュボードへ戻る
        </Link>

        <div
          style={{
            marginTop: 16,
            background: "#fff",
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 24,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, color: NAVY }}>制作会社向け修正指示書</h1>
          <p style={{ margin: "6px 0 20px", fontSize: 13, color: MUTED }}>
            {checkout === "cancelled"
              ? "決済がキャンセルされました。もう一度お試しいただけます。"
              : "ご注文ありがとうございます。生成状況をこちらでご確認いただけます。"}
          </p>

          <InstructionPdfStatusPanel orderId={order.id} />
        </div>
      </div>
    </main>
  );
}
