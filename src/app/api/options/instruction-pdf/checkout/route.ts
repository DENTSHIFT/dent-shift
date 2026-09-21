import { NextRequest, NextResponse } from "next/server";
import { getCurrentContact } from "@/server/auth/session";
import { prisma } from "@/server/db/prismaClient";
import {
  requestInstructionPdfOrder,
  InstructionPdfOrderError,
} from "@/server/services/optionOrders/requestInstructionPdfOrder";
import { OptionProductConfigError } from "@/server/config/optionProductConfig";
import { BillingConfigError } from "@/server/config/billingConfig";
import { getLatestSubscriptionByClinicId } from "@/server/db/billingRepository";
import { isEntitledSubscriptionStatus } from "@/domain/options/planEntitlements";
import type { PlanId } from "@/domain/billing/planCatalog";

/**
 * 「現在の制作会社へ依頼する」導線: 制作会社向け修正指示書の注文を作成する。
 * 無料枠(月1件/月3件)を消費できるのは、契約が無料枠を消費可能な状態
 * (trial/active/past_due/cancel_scheduled)にある場合のみ。判定・消費自体は
 * requestInstructionPdfOrder内でトランザクションとして行う(Phase3)。
 */
async function resolveEntitledPlanId(clinicId: string): Promise<PlanId | null> {
  const subscription = await getLatestSubscriptionByClinicId(clinicId);
  if (!subscription) return null;
  if (!isEntitledSubscriptionStatus(subscription.status)) return null;
  return subscription.plan;
}
export async function POST(request: NextRequest) {
  const currentContact = await getCurrentContact();
  if (!currentContact) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストボディがJSONとして解釈できません" }, { status: 400 });
  }
  const { reportId, improvementActionKey } = (body ?? {}) as Record<string, unknown>;
  if (typeof reportId !== "string" || !reportId) {
    return NextResponse.json({ error: "reportIdは必須です" }, { status: 400 });
  }

  // reportId(診断)が自院のものであることを必ず確認する(他clinicの診断IDを渡されても
  // 注文を作らせない。resultAccess.tsと同じ「所有者チェック」原則)。
  const diagnosis = await prisma.diagnosis.findFirst({
    where: { id: reportId, clinicId: currentContact.clinicId },
    select: { id: true },
  });
  if (!diagnosis) {
    return NextResponse.json({ error: "指定された診断結果が見つかりません" }, { status: 404 });
  }

  try {
    const planId = await resolveEntitledPlanId(currentContact.clinicId);
    const result = await requestInstructionPdfOrder({
      clinicId: currentContact.clinicId,
      contactId: currentContact.id,
      contactEmail: currentContact.email,
      reportId,
      improvementActionKey:
        typeof improvementActionKey === "string" ? improvementActionKey : undefined,
      planId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof OptionProductConfigError || error instanceof BillingConfigError) {
      console.error("[POST /api/options/instruction-pdf/checkout] configuration error");
      return NextResponse.json({ error: "現在この機能は利用できません。" }, { status: 503 });
    }
    if (error instanceof InstructionPdfOrderError) {
      console.error(
        "[POST /api/options/instruction-pdf/checkout] order error:",
        error.message
      );
      return NextResponse.json({ error: "注文を作成できませんでした。" }, { status: 502 });
    }
    console.error(
      "[POST /api/options/instruction-pdf/checkout] unexpected error:",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { error: "注文処理中にエラーが発生しました。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  }
}
