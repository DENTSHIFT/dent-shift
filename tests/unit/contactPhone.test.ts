import { describe, expect, it } from "vitest";
import {
  isValidClinicContactPhone,
  normalizeClinicContactPhone,
} from "@/domain/clinic/contactPhone";

describe("医院代表電話番号の検証", () => {
  it.each(["03-1234-5678", "090-1234-5678", "(03) 1234-5678"])(
    "国内の10〜11桁の番号を受け付ける: %s",
    (value) => {
      expect(isValidClinicContactPhone(value)).toBe(true);
    }
  );

  it.each(["", "123456789", "+81-3-1234-5678", "03-ABCD-5678"])(
    "未入力・国外形式・不正文字を拒否する: %s",
    (value) => {
      expect(isValidClinicContactPhone(value)).toBe(false);
    }
  );

  it("表示用記号を除いて数字だけに正規化する", () => {
    expect(normalizeClinicContactPhone("03-1234-5678")).toBe("0312345678");
  });
});
