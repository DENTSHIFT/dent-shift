import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_STARTED_SESSION_KEY,
  diagnosisStartedFiredMarker,
  isDiagnosisStartedAlreadyFired,
} from "@/app/diagnosis/diagnosisStartedTracking";

/**
 * 2026-09-24修正: sessionStorageに保存する「開始済みフラグ」の判定ロジックを、
 * DOM(sessionStorage実体)非依存の純粋関数として検証する。
 * ブラウザでの実際の"リロード/戻るで重複しないこと"は目視確認で担保する
 * (このプロジェクトにjsdom等のDOM環境テストは無いため)。
 */
describe("diagnosisStartedTracking", () => {
  it("キー名は固定文字列(sessionStorageのキーとして安定している)", () => {
    expect(DIAGNOSIS_STARTED_SESSION_KEY).toBe("ds_diagnosis_started_v1");
  });

  it("送信済みマーカーの値は、判定関数がtrueと認識する値と一致する", () => {
    expect(isDiagnosisStartedAlreadyFired(diagnosisStartedFiredMarker())).toBe(true);
  });

  it("nullの場合(未送信・sessionStorage未対応)はfalse", () => {
    expect(isDiagnosisStartedAlreadyFired(null)).toBe(false);
  });

  it("想定外の値(壊れたデータ等)はfalse扱いにする(計測を止めるより多重計測を許容する)", () => {
    expect(isDiagnosisStartedAlreadyFired("0")).toBe(false);
    expect(isDiagnosisStartedAlreadyFired("true")).toBe(false);
    expect(isDiagnosisStartedAlreadyFired("")).toBe(false);
  });
});
