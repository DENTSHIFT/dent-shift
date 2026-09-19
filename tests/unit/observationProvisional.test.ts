import { describe, expect, it } from "vitest";
import { resolveObservationProvisional } from "@/domain/ai-measurement/observationProvisional";

/**
 * 観測単位provisionalの決定ルールのunit test(2026-09-07のユーザー指示で確定)。
 */
describe("resolveObservationProvisional", () => {
  it("measurementStatus='measured'(sourceType='ai_provider')はfalseになる", () => {
    expect(resolveObservationProvisional("ai_provider", "measured")).toBe(false);
  });

  it("measurementStatus='reference'(sourceType='ai_provider')はtrueになる", () => {
    expect(resolveObservationProvisional("ai_provider", "reference")).toBe(true);
  });

  it("measurementStatus='unavailable'(sourceType='ai_provider')はfalseになる", () => {
    expect(resolveObservationProvisional("ai_provider", "unavailable")).toBe(false);
  });

  it("sourceType='mock'はmeasurementStatusによらず常にtrueになる", () => {
    expect(resolveObservationProvisional("mock", "reference")).toBe(true);
    expect(resolveObservationProvisional("mock", "measured")).toBe(true);
    expect(resolveObservationProvisional("mock", "unavailable")).toBe(true);
  });
});
