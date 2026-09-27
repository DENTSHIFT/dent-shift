import { NextResponse } from "next/server";
import {
  BillingConfigError,
  resolveBillingConfigFromProcessEnv,
} from "@/server/config/billingConfig";
import { applyBillingWebhookEvent } from "@/server/db/billingRepository";
import {
  normalizeStripeBillingEvent,
  normalizeStripeOneTimePurchaseEvent,
  StripeWebhookVerificationError,
  verifyStripeWebhookEvent,
} from "@/server/providers/billing/stripeWebhookProvider";
import { applyOptionOrderWebhookEvent } from "@/server/db/optionOrderRepository";
import { prisma } from "@/server/db/prismaClient";
import { activateTrialIfEligible } from "@/server/services/activateTrial";
import { generateInstructionPdfArtifact } from "@/server/services/optionOrders/generateInstructionPdfArtifact";
import { consumeInviteForClinic, getInviteById } from "@/server/db/inviteRepository";
import { computeInviteCancelAtEpochSeconds } from "@/domain/invite/inviteCode";
import {
  retrieveStripeSubscription,
  scheduleStripeSubscriptionCancellation,
} from "@/server/providers/billing/stripeCheckoutProvider";
import { sendBillingStatusChangeEmail } from "@/server/services/sendBillingStatusChangeEmail";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";
import { consumeTrialEntitlementFromWebhook } from "@/server/db/trialEntitlementRepository";
import { isVerifiedTrialingSubscriptionForConsumption } from "@/domain/billing/trialEntitlement";
import { syncIntegrationEvent } from "@/server/services/salesforceSync";

export const runtime = "nodejs";

/**
 * checkout.session.completedがサブスク用(プラン契約)か単発商品購入
 * (制作会社向け修正指示書等)かを、object.subscriptionの有無で判定する。
 * 同じイベントを両方のapply*WebhookEvent()へ渡すと、billingWebhookEvent行の
 * 早い者勝ちの一意制約により後発側が誤ってduplicate扱いになるため、
 * どちらか一方だけに振り分ける(二重処理防止の要)。
 */
function isOneTimeCheckoutCompleted(event: { type: string; data: { object: unknown } }): boolean {
  if (event.type !== "checkout.session.completed") return false;
  const object = event.data.object as Record<string, unknown> | null;
  return !object?.subscription;
}

export async function POST(request: Request) {
  let config;
  try {
    config = resolveBillingConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      console.error("[POST /api/billing/webhook] billing configuration error");
      return NextResponse.json({ error: "決済通知は現在無効です。" }, { status: 503 });
    }
    throw error;
  }
  if (config.provider === "disabled") {
    return NextResponse.json({ error: "決済通知は現在無効です。" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "署名がありません。" }, { status: 400 });
  }

  // JSONへ変換する前の本文がStripeの署名検証に必要。
  const payload = await request.text();
  let event;
  try {
    event = verifyStripeWebhookEvent({
      payload,
      signature,
      apiKey: config.apiKey,
      webhookSecret: config.webhookSecret,
    });
  } catch (error) {
    if (error instanceof StripeWebhookVerificationError) {
      return NextResponse.json({ error: "署名を確認できませんでした。" }, { status: 400 });
    }
    throw error;
  }

  try {
    if (isOneTimeCheckoutCompleted(event)) {
      const command = normalizeStripeOneTimePurchaseEvent(event);
      const result = await applyOptionOrderWebhookEvent(command);

      // 決済確認(generation_queuedへの遷移)の直後に生成まで進める。生成失敗は
      // ここで握りつぶし、決済自体は成功として200を返す(Stripe側の再送・二重課金を防ぐ)。
      // 失敗した生成はClinicAuditLog/GeneratedArtifact.lastErrorに記録済みで、
      // ダッシュボード側の再生成導線(Phase6)から再試行できる。
      if (result === "processed" && command.action.kind === "one_time_paid") {
        const order = await prisma.optionOrder.findUnique({
          where: { stripeCheckoutSessionId: command.action.identity.stripeCheckoutSessionId },
          select: { id: true },
        });
        if (order) {
          await generateInstructionPdfArtifact(order.id).catch((generationError) => {
            console.error(
              "[POST /api/billing/webhook] generateInstructionPdfArtifact failed:",
              generationError instanceof Error ? generationError.message : "UnknownError"
            );
          });
        }
      }

      return NextResponse.json({ received: true, result });
    }

    const command = normalizeStripeBillingEvent(event);
    const {
      result,
      notify,
      trialActivated,
      subscriptionActivated,
      subscriptionActivatedIntegrationEventId,
    } = await applyBillingWebhookEvent(command);

    // 契約作成前に先着したinvoiceイベント。処理済みにせず、Stripeの再送で取りこぼしなく反映する。
    if (result === "retry") {
      return NextResponse.json({ received: false, result }, { status: 409 });
    }

    // 2026-09-27追加、2026-09-28修正(PO再指摘): Stripe Webhookの確定情報により
    // Subscription.statusが実際に(trial以外)→trialへ遷移した場合に"trial_activated"を
    // 記録する。dedupeKey(`trial_activated:${externalSubscriptionId}`)を必ず指定し、
    // 下のTrialEntitlement消費経路(同じdedupeKeyを使用)とどちらが先に到達しても、
    // DBのユニーク制約により最終的にイベントが1件だけになるようにする(二重計上防止。
    // 同一Webhookイベント自体の再送はproviderEventIdの一意制約で"duplicate"となり
    // trialActivatedがnullになるため、そもそもここへ到達しない)。
    if (trialActivated) {
      await enqueueIntegrationEvent({
        eventType: "trial_activated",
        clinicId: trialActivated.clinicId,
        payload: {},
        dedupeKey: `trial_activated:${trialActivated.externalSubscriptionId}`,
      }).catch((error) => {
        console.error(
          "[POST /api/billing/webhook] trial_activated event enqueue failed:",
          error instanceof Error ? error.name : "UnknownError"
        );
      });
    }

    // 2026-09-28追加(PO承認、P1-4「有料契約への移行」): "subscription_activated"の
    // DB記録(outbox)自体はapplyBillingWebhookEvent()内の同一トランザクションで
    // 既に確定済み(ON CONFLICT DO NOTHINGによる原子的なdedupe)。ここでは、新規作成
    // された場合のみベストエフォートでSalesforce同期を1回試行する
    // (DB記録と外部同期の失敗を分離する、既存のTrialEntitlement消費経路と同じ方針)。
    if (subscriptionActivated && subscriptionActivatedIntegrationEventId) {
      await syncIntegrationEvent(subscriptionActivatedIntegrationEventId).catch((syncError) => {
        console.error(
          "[POST /api/billing/webhook] subscription_activated event sync failed (will retry via pending-event job):",
          syncError
        );
      });
    }

    // 契約状態が悪化方向(past_due/restricted/suspended)または解約(cancelled)へ
    // 実際に遷移した場合のみ通知メールを送る(applyBillingWebhookEvent側で
    // 状態変化の有無を判定済み。Webhook再送による重複送信はここに来ない)。
    if (notify) {
      await sendBillingStatusChangeEmail({
        clinicId: notify.clinicId,
        status: notify.toStatus,
      }).catch((emailError) => {
        console.error(
          "[POST /api/billing/webhook] sendBillingStatusChangeEmail failed:",
          emailError instanceof Error ? emailError.name : "UnknownError"
        );
      });
    }

    // 2026-09-27追加、2026-09-28全面修正(PO再指摘): metadataにtrial_entitlement_idが
    // 含まれる(=無料トライアル対象として予約済みの)checkout.session.completedについて、
    // TrialEntitlementの消費確定を試みる。**同一providerEventIdの重複排除(billingWebhookEvent
    // の一意制約によるresult==="duplicate")とは独立に**、command.action自体がcheckout_completed
    // かつtrialEntitlementIdを持つ限り毎回実行する。理由: Stripe側の一時的な取得失敗で
    // 消費できなかった場合、このWebhookイベントが再送されてきたときにresultは"duplicate"に
    // なるが、消費自体はまだ済んでいないため、ここは"processed"限定にしてはならない
    // (消費側の冪等性はTrialEntitlement.status条件付き更新自体が担保する)。
    if (command.action?.kind === "checkout_completed" && command.action.identity.clinicId) {
      const identity = command.action.identity;
      const clinicId = identity.clinicId as string;
      if (identity.trialEntitlementId) {
        const trialEntitlementId = identity.trialEntitlementId;
        // checkout.session.completedのmetadataだけを消費の根拠にしない(PO再指摘)。
        // Stripe上のSubscriptionの実データ(status="trialing"・trial_start/trial_end・
        // metadataの再照合)を取得して検証してから消費する。
        let verifiedSubscription: Awaited<ReturnType<typeof retrieveStripeSubscription>> | "fetch_failed";
        try {
          verifiedSubscription = await retrieveStripeSubscription({
            apiKey: config.apiKey,
            subscriptionId: identity.externalSubscriptionId,
          });
        } catch (fetchError) {
          verifiedSubscription = "fetch_failed";
          console.error(
            "[POST /api/billing/webhook] retrieveStripeSubscription failed (transient), returning non-2xx so Stripe retries:",
            fetchError instanceof Error ? fetchError.name : "UnknownError"
          );
        }

        if (verifiedSubscription === "fetch_failed") {
          // Stripe APIの一時障害を200で握り潰すと永久に未消費になるため、ここで
          // 非2xxを返してStripeにこのイベントを再送させる(消費自体は冪等なので
          // 再送で二重消費にはならない)。
          return NextResponse.json(
            { error: "決済状態を確認できませんでした。" },
            { status: 502 }
          );
        }

        if (verifiedSubscription === null) {
          // Subscriptionが(まだ)存在しない。一時的レースの可能性はあるが、
          // 無限リトライにはしない(genuine not-foundを再試行し続けるのは危険)。
          console.warn(
            "[POST /api/billing/webhook] TrialEntitlement consumption skipped: Subscription not found",
            { trialEntitlementId, clinicId }
          );
        } else if (
          !isVerifiedTrialingSubscriptionForConsumption({
            subscription: verifiedSubscription,
            expectedClinicId: clinicId,
            expectedTrialEntitlementId: trialEntitlementId,
            plan: identity.plan,
          })
        ) {
          // metadataの自己申告と実際のSubscription状態が一致しない(例: 既にactiveへ
          // 遷移済み、metadata不一致等)。消費しない。これも無限リトライ対象ではない
          // (genuineな不一致であり、Stripe側の障害ではないため)。
          console.warn(
            "[POST /api/billing/webhook] TrialEntitlement consumption skipped: subscription not verified as trialing",
            { trialEntitlementId, clinicId, subscriptionStatus: verifiedSubscription.status }
          );
        } else {
          // 2026-09-28修正(PO再指摘): DB一時障害(接続エラー・タイムアウト・deadlock・
          // serialization failure・IntegrationEvent作成失敗・commit失敗)を"例外をログに
          // 出して200"で握り潰さない。ここでは意図的にcatchしない — 例外はこのブロックの
          // 外側にある関数全体のtry/catch(下記)まで伝播させ、Stripeに再送させる非2xxを
          // 返す。consumeTrialEntitlementFromWebhook自体が正常に解決して返す結果
          // (not_found_or_mismatch/already_consumed_idempotent/consumed)はすべて
          // 「意図した分岐」であり、これらはDB例外ではないため200のままでよい
          // (metadata不一致・対象外・重複到達はいずれもno-opとして正常応答するのが正しい)。
          const { result: consumeResult, integrationEventId } = await consumeTrialEntitlementFromWebhook({
            trialEntitlementId,
            clinicId,
            checkoutSessionId: command.action.checkoutSessionId,
            externalSubscriptionId: identity.externalSubscriptionId,
            occurredAt: command.occurredAt,
          });
          if (consumeResult === "not_found_or_mismatch") {
            // PII/秘密値を含まないIDのみログに残す。運用上の異常として監視対象にする。
            console.warn(
              "[POST /api/billing/webhook] TrialEntitlement consumption mismatch",
              { trialEntitlementId, clinicId }
            );
          } else if (integrationEventId) {
            // "trial_activated"はconsumeTrialEntitlementFromWebhook内の同一トランザクションで
            // 既にDBへ記録済み(dedupeKeyにより二重記録されない、ON CONFLICT DO NOTHING)。
            // 2026-09-28修正(PO再指摘、外部同期失敗とDB記録の分離): ここから先の
            // Salesforce同期はベストエフォートであり、その成否はこのWebhookの成功応答に
            // 影響させない。DB記録(outbox)は既に確定しているため、同期が失敗しても
            // status="failed"のままDBに残り、既存の再試行ジョブ(retryPendingIntegrationEvents)
            // が後から再処理する。よってここだけは意図的にcatchしてログに留める。
            await syncIntegrationEvent(integrationEventId).catch((syncError) => {
              console.error(
                "[POST /api/billing/webhook] trial_activated event sync failed (will retry via pending-event job):",
                syncError
              );
            });
          }
        }
      }
    }

    // 決済方法登録完了(checkout完了)を契機に、他の3条件(SMS/メール/規約同意)が
    // 既に揃っていればtrialを開始する(指示書4章、activateTrial.ts参照)。
    if (result === "processed" && command.action?.kind === "checkout_completed") {
      const identity = command.action.identity;
      const clinicId = identity.clinicId;
      if (clinicId) {
        const contacts = await prisma.contact.findMany({ where: { clinicId } });
        for (const contact of contacts) {
          await activateTrialIfEligible(contact.id).catch((activationError) => {
            console.error(
              "[POST /api/billing/webhook] activateTrialIfEligible failed:",
              activationError
            );
          });
        }

        // 2026-09-22: 知人院長向け1円招待モニター経由の決済のみ、招待を消費し、
        // Subscription自体にcancel_at(durationMonths後の絶対時刻)を設定する。
        // Checkout Session作成時にはcancel_atを設定できない(Stripe API制約、
        // requestInviteCheckout.ts参照)ため、決済確定後のここで別途更新する。
        const inviteId = identity.inviteId;
        if (inviteId) {
          await consumeInviteForClinic({ inviteId, clinicId }).catch((inviteError) => {
            console.error(
              "[POST /api/billing/webhook] consumeInviteForClinic failed:",
              inviteError
            );
          });
          await getInviteById(inviteId)
            .then((invite) => {
              if (!invite) return;
              const cancelAtEpochSeconds = computeInviteCancelAtEpochSeconds(
                new Date(),
                invite.durationMonths
              );
              return scheduleStripeSubscriptionCancellation({
                apiKey: config.apiKey,
                subscriptionId: identity.externalSubscriptionId,
                cancelAtEpochSeconds,
              });
            })
            .catch((cancelError) => {
              console.error(
                "[POST /api/billing/webhook] scheduleStripeSubscriptionCancellation failed:",
                cancelError
              );
            });
        }
      }
    }

    return NextResponse.json({ received: true, result });
  } catch (error) {
    console.error(
      "[POST /api/billing/webhook] processing failed:",
      error instanceof Error ? error.name : "UnknownError",
      (error as { code?: unknown } | null)?.code ?? ""
    );
    return NextResponse.json({ error: "決済通知を処理できませんでした。" }, { status: 500 });
  }
}
