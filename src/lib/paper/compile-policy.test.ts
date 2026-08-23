import { describe, expect, it } from "vitest";
import { assertCompileArtifactSize, assertCompileBundleLimits, CompilePolicyError, compileResourceLimits, safeCompilePath } from "./compile-policy";

describe("paper compile policy", () => {
  it("normalizes safe relative paths and rejects traversal", () => {
    expect(safeCompilePath("assets/figure.png")).toBe("assets/figure.png");
    expect(() => safeCompilePath("../secrets.env")).toThrowError(CompilePolicyError);
    expect(() => safeCompilePath("/etc/passwd")).toThrowError(CompilePolicyError);
  });

  it("enforces file count and aggregate source quotas", () => {
    const limits = { ...compileResourceLimits({}), maxFiles: 1, maxSourceBytes: 4 };
    expect(() => assertCompileBundleLimits({ limits, files: [{ path: "main.tex", bytes: 5 }] })).toThrow("输入资源");
    expect(() => assertCompileBundleLimits({ limits, files: [{ path: "a", bytes: 1 }, { path: "b", bytes: 1 }] })).toThrow("文件数量");
  });

  it("enforces artifact quota", () => {
    expect(() => assertCompileArtifactSize(9, { ...compileResourceLimits({}), maxArtifactBytes: 8 })).toThrow("编译产物");
  });
});
