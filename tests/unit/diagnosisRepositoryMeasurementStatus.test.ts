import { describe, expect, it } from "vitest";
import {
  LegacyLiveAiObservationError,
  resolveMeasurementStatusForNewObservation,
} from "@/server/db/diagnosisRepository";

/**
 * 2026-09-07のユーザー指示(Phase 2: measurementStatus NOT NULL化の前提整理)。
 * 「新規AiObservation保存コードからmeasurementStatus=nullを書き込む経路が存在しないこと」
 * を、resolveMeasurementStatusForNewObservation()単体で検証する。
 *
 * この関数の戻り値の型はstring(non-nullable)であり、"mock" | "live"の2値を網羅的に
 * 分岐している(mockはstringを返す、liveはthrowする)。したがって、この2テストが両方
 * 通ることは、TypeScriptの型検査(nullを返す分岐が存在すればコンパイルエラーになる)と
 * 合わせて「measurementStatus=nullを書き込む経路が存在しないこと」の二重の保証になる。
 * 実DBには一切触れない純粋なテスト(prismaClient.tsは静的importされるが、PrismaClientの
 * コンストラクタ自体は接続を張らないため、DB I/Oは発生しない)。
 */
describe("resolveMeasurementStatusForNewObservation", () => {
  it("dataSource='mock'のときは常に'reference'を返す(nullを返す経路が無いことをstring型と併せて保証する)", () => {
    const status: string = resolveMeasurementStatusForNewObservation("mock");
    expect(status).toBe("reference");
  });

  it("dataSource='live'のときは'measured'等へ推測変換せず、LegacyLiveAiObservationErrorをthrowする(nullやmeasuredを返す経路は存在しない)", () => {
    expect(() => resolveMeasurementStatusForNewObservation("live")).toThrow(
      LegacyLiveAiObservationError
    );
    expect(() => resolveMeasurementStatusForNewObservation("live")).toThrow(
      "Legacy live AiObservation cannot be persisted without explicit measurementStatus"
    );
  });
});
