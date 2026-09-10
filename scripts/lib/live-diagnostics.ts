/**
 * Live diagnostics 共享基础设施。
 *
 * 安全模型：
 * - 任何会调用真实收费/有额度 API 或创建 Research Run 的脚本都必须经过
 *   requireLiveSmoke()：只有显式设置 LUMENLAB_LIVE_SMOKE=1 才会真正执行，
 *   否则只打印用途并以退出码 0 结束；CI 与单元测试永不触网。
 * - 输出统一为 [PASS] / [WARN] / [FAIL] 单行格式，detail 一律截断，
 *   不打印 secret、完整研究 query、原始 Evidence 全文或隐藏 reasoning。
 * - 退出码：全部关键条件满足 0；确定 correctness failure 2。
 *   外部 provider 的瞬时降级用 [WARN] 表达，不视为 correctness failure。
 */

export const LIVE_SMOKE_ENV = "LUMENLAB_LIVE_SMOKE";

export function isLiveSmokeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[LIVE_SMOKE_ENV]?.trim() === "1";
}

/**
 * live 门禁。未 opt-in 时打印用途并返回 false（调用方应 process.exit(0)）。
 */
export function requireLiveSmoke(
  script: string,
  usage: string,
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
): boolean {
  if (isLiveSmokeEnabled(env)) return true;
  log(`[${script}] live smoke disabled — 该脚本会调用真实外部服务。`);
  log(`[${script}] 确认后显式执行：${LIVE_SMOKE_ENV}=1 ${usage}`);
  return false;
}

export interface DiagnosticsCounts {
  passed: number;
  warned: number;
  failed: number;
}

export interface DiagnosticsReporter {
  pass(label: string, detail?: unknown): void;
  warn(label: string, detail?: unknown): void;
  fail(label: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  counts(): DiagnosticsCounts;
  /** 0 = 全部关键检查通过；2 = 存在 correctness failure。 */
  exitCode(): number;
  /** 打印汇总行并返回 exitCode。 */
  summarize(): number;
}

const DETAIL_MAX_CHARS = 600;

function formatDetail(detail: unknown): string {
  if (detail === undefined) return "";
  const raw = typeof detail === "string" ? detail : JSON.stringify(detail);
  return ` ${raw.length > DETAIL_MAX_CHARS ? `${raw.slice(0, DETAIL_MAX_CHARS)}…` : raw}`;
}

export function createDiagnosticsReporter(
  script: string,
  log: (line: string) => void = console.log,
): DiagnosticsReporter {
  const counts: DiagnosticsCounts = { passed: 0, warned: 0, failed: 0 };
  const reporter: DiagnosticsReporter = {
    pass(label, detail) {
      counts.passed += 1;
      log(`[PASS] ${label}${formatDetail(detail)}`);
    },
    warn(label, detail) {
      counts.warned += 1;
      log(`[WARN] ${label}${formatDetail(detail)}`);
    },
    fail(label, detail) {
      counts.failed += 1;
      log(`[FAIL] ${label}${formatDetail(detail)}`);
    },
    info(message, detail) {
      log(`[${script}] ${message}${formatDetail(detail)}`);
    },
    counts: () => ({ ...counts }),
    exitCode: () => (counts.failed > 0 ? 2 : 0),
    summarize() {
      const code = reporter.exitCode();
      log(`[${script}] ${counts.passed} passed, ${counts.warned} warned, ${counts.failed} failed → exit ${code}`);
      return code;
    },
  };
  return reporter;
}

/** 解析 --flag 与 --key value 形式的 CLI 参数（保持刻意简单）。 */
export function parseCliArgs(argv: string[]): { flags: Set<string>; values: Map<string, string> } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { flags, values };
}
