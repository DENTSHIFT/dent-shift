import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/domain/auth/safeNextPath";

describe("safeNextPath", () => {
  it("同一サイト内の相対パスを許可する", () => {
    expect(safeNextPath("/diagnosis/result/abc")).toBe("/diagnosis/result/abc");
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
  });

  it("絶対URL(外部サイト)を拒否する", () => {
    expect(safeNextPath("https://example.com")).toBeNull();
    expect(safeNextPath("http://example.com")).toBeNull();
  });

  it("プロトコル相対URL(//evil.example)を拒否する", () => {
    expect(safeNextPath("//example.com")).toBeNull();
  });

  it("javascript:スキームを拒否する", () => {
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
  });

  it("バックスラッシュを含む値を拒否する(ブラウザの//正規化によるバイパス対策)", () => {
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("\\\\evil.example")).toBeNull();
  });

  it("未指定・空文字はnullを返す(呼び出し側で既定先にフォールバックする)", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});
