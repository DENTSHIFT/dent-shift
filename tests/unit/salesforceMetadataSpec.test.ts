import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SF_FIELDS } from "@/domain/integration/salesforceCrmMapping";

// アプリが送る項目と、Salesforceへ追加する項目定義(salesforce/tools/fields.json)・生成済みメタデータが
// 食い違うと、本番でINVALID_FIELDとなり同期が全件失敗する。その食い違いをテストで検出する。
const ROOT = path.resolve(__dirname, "../..");
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "salesforce/tools/fields.json"), "utf8")) as {
  summary: string[][];
  objects: Record<string, { fields: string[][] }>;
};

function definedFields(object: string): Set<string> {
  const fields = spec.objects[object]!.fields.flatMap((f) => (f[0] === "@summary" ? spec.summary : [f]));
  return new Set(fields.map((f) => f[0]!));
}

const OBJECT_OF: Record<keyof typeof SF_FIELDS, string> = {
  lead: "Lead",
  account: "Account",
  contact: "Contact",
  opportunity: "Opportunity",
  diagnosis: "DentShift_Diagnosis__c",
  consultation: "DentShift_Consultation__c",
};

describe("Salesforce項目定義とアプリの送信項目の一致", () => {
  it.each(Object.entries(OBJECT_OF))("%s の送信項目はすべて項目定義とメタデータに存在する", (key, object) => {
    const defined = definedFields(object);
    const sent = Object.entries(SF_FIELDS[key as keyof typeof SF_FIELDS])
      .filter(([name]) => name !== "sobject")
      .map(([, api]) => api as string);
    for (const api of sent) {
      expect(defined, `${object}.${api}`).toContain(api);
      const existing = spec.objects[object]!.fields.some((f) => f[0] === api && f[1] === "Existing");
      if (!existing) {
        expect(fs.existsSync(path.join(ROOT, `salesforce/force-app/main/default/objects/${object}/fields/${api}.field-meta.xml`)), `${object}.${api} xml`).toBe(true);
      }
    }
  });

  it("相談の実施結果・担当者メモは同期で書き込まない(担当者入力専用)", () => {
    expect(Object.values(SF_FIELDS.consultation)).not.toContain("DentShift_Attendance__c");
    expect(Object.values(SF_FIELDS.consultation)).not.toContain("DentShift_Staff_Notes__c");
  });

  it("営業電話禁止(DentShift_Do_Not_Call__c)とその根拠は同期で書き込まない(担当者入力専用)", () => {
    expect(Object.values(SF_FIELDS.lead)).not.toContain("DentShift_Do_Not_Call__c");
    expect(Object.values(SF_FIELDS.lead)).not.toContain("DentShift_Do_Not_Call_Reason__c");
    expect(Object.values(SF_FIELDS.contact)).not.toContain("DentShift_Do_Not_Call__c");
    expect(Object.values(SF_FIELDS.contact)).not.toContain("DentShift_Do_Not_Call_Reason__c");
  });
});
