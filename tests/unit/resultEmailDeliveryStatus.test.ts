import { describe, expect, it } from "vitest";
import {
  buildResultEmailDeliveryNotice,
  normalizeResultEmailDeliveryStatus,
} from "@/domain/email/resultEmailDeliveryStatus";

describe("診断結果メールの表示状態", () => {
  it.each(["pending", "sent", "failed", "disabled"] as const)(
    "保存可能な状態を維持する: %s",
    (status) => {
      expect(normalizeResultEmailDeliveryStatus(status)).toBe(status);
    }
  );

  it("不明なDB値は送信済みと誤表示せず確認中にする", () => {
    expect(normalizeResultEmailDeliveryStatus("unknown")).toBe("pending");
  });

  it("送信成功を明確に案内する", () => {
    expect(buildResultEmailDeliveryNotice("sent")).toEqual(
      expect.objectContaining({
        tone: "success",
        title: "診断結果メールを送信しました",
      })
    );
  });

  it("送信失敗時も結果ページを確認できることを案内する(控えめな通知にする)", () => {
    const notice = buildResultEmailDeliveryNotice("failed");
    expect(notice.tone).toBe("info");
    expect(notice.text).toContain("このページで結果をご確認ください");
  });
});
