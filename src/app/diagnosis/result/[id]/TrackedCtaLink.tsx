"use client";

import type { AnchorHTMLAttributes } from "react";

/**
 * 診断結果画面のCTA(オンライン説明予約・電話問い合わせ)クリックを計測する薄いラッパー。
 * navigator.sendBeaconでfire-and-forget送信し、外部サイトへの遷移(target="_blank")や
 * tel:リンクの起動をブロックしない(指示書3章・13章)。
 */
export function TrackedCtaLink({
  diagnosisId,
  eventType,
  children,
  ...anchorProps
}: {
  diagnosisId: string;
  eventType: "online_consultation_clicked" | "phone_inquiry_clicked";
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...anchorProps}
      onClick={(event) => {
        try {
          const payload = JSON.stringify({ eventType, diagnosisId });
          if (navigator.sendBeacon) {
            navigator.sendBeacon(
              "/api/events/track",
              new Blob([payload], { type: "application/json" })
            );
          } else {
            fetch("/api/events/track", { method: "POST", body: payload, keepalive: true }).catch(
              () => {}
            );
          }
        } catch {
          // 計測失敗でCTA自体の遷移は妨げない。
        }
        anchorProps.onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
