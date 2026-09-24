import { prisma } from "./prismaClient";

// 2026-09-24: 運用者が「診断開始→完了→相談CTAクリック」の件数を、Salesforce連携の
// 有効/無効に関わらず確認できるようにする(IntegrationEventはSalesforce同期状態と
// 無関係に、イベント発生自体を記録しているため、Salesforce disabled中でも件数集計は
// 正しく行える)。UTM流入元別の内訳も同時に集計する。
const FUNNEL_EVENT_TYPES = [
  "diagnosis_started",
  "diagnosis_completed",
  "online_consultation_clicked",
] as const;

type FunnelEventType = (typeof FUNNEL_EVENT_TYPES)[number];

export interface FunnelCounts {
  started: number;
  completed: number;
  consultationClicked: number;
}

export interface DiagnosisFunnelMetrics extends FunnelCounts {
  byUtmSource: Record<string, FunnelCounts>;
  unattributedCount: number;
  totalEventsScanned: number;
}

function emptyCounts(): FunnelCounts {
  return { started: 0, completed: 0, consultationClicked: 0 };
}

function bumpCounts(counts: FunnelCounts, eventType: FunnelEventType) {
  if (eventType === "diagnosis_started") counts.started += 1;
  else if (eventType === "diagnosis_completed") counts.completed += 1;
  else counts.consultationClicked += 1;
}

/**
 * 指定期間内のdiagnosis_started/diagnosis_completed/online_consultation_clickedを
 * UTM流入元(utm_source)別に集計する。payloadJsonはSQLite/Postgres共通で単なる
 * テキスト列のためSQL側での集計はせず、対象期間の行を取得してアプリ側で集計する
 * (現状の想定件数では十分実用的。件数が大きく増えた場合は要見直し)。
 */
export async function getDiagnosisFunnelMetrics(range: {
  from: Date;
  to: Date;
}): Promise<DiagnosisFunnelMetrics> {
  const events = await prisma.integrationEvent.findMany({
    where: {
      eventType: { in: [...FUNNEL_EVENT_TYPES] },
      createdAt: { gte: range.from, lte: range.to },
    },
    select: { eventType: true, payloadJson: true },
  });

  const total = emptyCounts();
  const byUtmSource: Record<string, FunnelCounts> = {};
  let unattributedCount = 0;

  for (const event of events) {
    const eventType = event.eventType as FunnelEventType;
    bumpCounts(total, eventType);

    let utmSource: string | null = null;
    try {
      const payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
      utmSource = typeof payload.utm_source === "string" ? payload.utm_source : null;
    } catch {
      utmSource = null;
    }

    if (!utmSource) {
      unattributedCount += 1;
      continue;
    }
    byUtmSource[utmSource] ??= emptyCounts();
    bumpCounts(byUtmSource[utmSource]!, eventType);
  }

  return {
    ...total,
    byUtmSource,
    unattributedCount,
    totalEventsScanned: events.length,
  };
}
