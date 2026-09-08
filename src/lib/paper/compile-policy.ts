import { relative, resolve } from "node:path";

export interface CompileResourceLimits {
  wallTimeMs: number;
  maxFiles: number;
  maxSourceBytes: number;
  maxArtifactBytes: number;
  maxLogBytes: number;
}

export const DEFAULT_COMPILE_RESOURCE_LIMITS: CompileResourceLimits = {
  wallTimeMs: 120_000,
  maxFiles: 500,
  maxSourceBytes: 40 * 1024 * 1024,
  maxArtifactBytes: 80 * 1024 * 1024,
  maxLogBytes: 12_000,
};

export class CompilePolicyError extends Error {
  constructor(public readonly code: "COMPILE_PATH_REJECTED" | "COMPILE_QUOTA_EXCEEDED", message: string) {
    super(message);
  }
}

function positiveEnv(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
}

export function compileResourceLimits(environment: Partial<NodeJS.ProcessEnv> = process.env): CompileResourceLimits {
  return {
    wallTimeMs: positiveEnv(environment.PAPER_COMPILE_TIMEOUT_MS, DEFAULT_COMPILE_RESOURCE_LIMITS.wallTimeMs, 300_000),
    maxFiles: positiveEnv(environment.PAPER_COMPILE_MAX_FILES, DEFAULT_COMPILE_RESOURCE_LIMITS.maxFiles, 2_000),
    maxSourceBytes: positiveEnv(environment.PAPER_COMPILE_MAX_SOURCE_BYTES, DEFAULT_COMPILE_RESOURCE_LIMITS.maxSourceBytes, 200 * 1024 * 1024),
    maxArtifactBytes: positiveEnv(environment.PAPER_COMPILE_MAX_ARTIFACT_BYTES, DEFAULT_COMPILE_RESOURCE_LIMITS.maxArtifactBytes, 200 * 1024 * 1024),
    maxLogBytes: positiveEnv(environment.PAPER_COMPILE_MAX_LOG_BYTES, DEFAULT_COMPILE_RESOURCE_LIMITS.maxLogBytes, 100_000),
  };
}

export function safeCompilePath(path: string): string {
  if (!path || path.includes("\0")) throw new CompilePolicyError("COMPILE_PATH_REJECTED", "编译资源路径无效");
  const normalized = path.replaceAll("\\", "/");
  const resolved = resolve("/compile-workspace", normalized);
  const relativePath = relative("/compile-workspace", resolved);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes("/../") || relativePath.startsWith("/")) {
    throw new CompilePolicyError("COMPILE_PATH_REJECTED", "编译资源路径越界");
  }
  return relativePath.replaceAll("\\", "/");
}

export function assertCompileBundleLimits(input: { files: Array<{ path: string; bytes: number }>; limits?: CompileResourceLimits }) {
  const limits = input.limits ?? compileResourceLimits();
  if (input.files.length > limits.maxFiles) throw new CompilePolicyError("COMPILE_QUOTA_EXCEEDED", "编译文件数量超过限制");
  let totalBytes = 0;
  for (const file of input.files) {
    safeCompilePath(file.path);
    if (!Number.isInteger(file.bytes) || file.bytes < 0) throw new CompilePolicyError("COMPILE_QUOTA_EXCEEDED", "编译资源大小无效");
    totalBytes += file.bytes;
  }
  if (totalBytes > limits.maxSourceBytes) throw new CompilePolicyError("COMPILE_QUOTA_EXCEEDED", "编译输入资源超过限制");
}

export function assertCompileArtifactSize(bytes: number, limits = compileResourceLimits()) {
  if (bytes > limits.maxArtifactBytes) throw new CompilePolicyError("COMPILE_QUOTA_EXCEEDED", "编译产物超过限制");
}
