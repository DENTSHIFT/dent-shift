import { describe, expect, it } from "vitest";
import { generateInstructionPdfPassword } from "@/domain/options/pdfPassword";

describe("generateInstructionPdfPassword", () => {
  it("12文字で、紛らわしい文字(0/O/1/I/L)を含まない", () => {
    for (let i = 0; i < 50; i++) {
      const password = generateInstructionPdfPassword();
      expect(password).toHaveLength(12);
      expect(password).not.toMatch(/[01OIL]/);
    }
  });

  it("毎回異なる値を生成する(固定値でない)", () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generateInstructionPdfPassword()));
    expect(passwords.size).toBeGreaterThan(1);
  });
});
