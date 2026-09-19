import { describe, expect, it } from "vitest";
import {
  detectClinicDuplicateCandidate,
  duplicateCandidateMessage,
} from "@/domain/clinic/duplicateDetection";

const clinics = [
  { id: "clinic-a", name: "さくら歯科", url: "https://www.sakura-dental.jp/" },
  { id: "clinic-b", name: "青空デンタル", url: "https://aozora.example.jp/about" },
  { id: "clinic-c", name: "ひかり 歯科", url: "https://hikari.example.jp/" },
];

describe("detectClinicDuplicateCandidate", () => {
  it("protocol・www・queryの差を除いた完全URL一致を最優先で検出する", () => {
    expect(
      detectClinicDuplicateCandidate(
        {
          clinicName: "別名入力",
          clinicUrl: "http://sakura-dental.jp/?utm_source=form#top",
        },
        clinics
      )
    ).toEqual({ clinicId: "clinic-a", matchType: "exact_url" });
  });

  it("同じhostでpathが違う場合はドメイン一致として検出する", () => {
    expect(
      detectClinicDuplicateCandidate(
        { clinicName: "別名入力", clinicUrl: "https://aozora.example.jp/treatment" },
        clinics
      )
    ).toEqual({ clinicId: "clinic-b", matchType: "same_domain" });
  });

  it("URLが異なっても表記ゆれを正規化した医院名が一致すれば検出する", () => {
    expect(
      detectClinicDuplicateCandidate(
        { clinicName: "ひかり　歯科", clinicUrl: "https://different.example.com" },
        clinics
      )
    ).toEqual({ clinicId: "clinic-c", matchType: "exact_name" });
  });

  it("一致しない医院は候補にしない", () => {
    expect(
      detectClinicDuplicateCandidate(
        { clinicName: "新規歯科", clinicUrl: "https://new-clinic.example.com" },
        clinics
      )
    ).toBeNull();
  });

  it("不正URLは医院名だけで候補判定せずnullにする", () => {
    expect(
      detectClinicDuplicateCandidate(
        { clinicName: "さくら歯科", clinicUrl: "not a url ///" },
        clinics
      )
    ).toBeNull();
  });

  it("案内文は既存医院IDを含めない", () => {
    expect(duplicateCandidateMessage("exact_url")).not.toContain("clinic-");
    expect(duplicateCandidateMessage("exact_name")).toContain("ログイン");
  });
});
