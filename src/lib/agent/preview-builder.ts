/**
 * Tool 调用预览生成器
 *
 * 把 Tool 元数据 + 实际参数聚合成用户能看懂的执行摘要，
 * 敏感字段在此阶段脱敏（API key、邮箱、cookie 等）。
 */

import type {
  AgentContext,
  AffectedResource,
  ToolCallPreview,
  ToolMetadata,
} from "./types";

const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sk-[a-zA-Z0-9_\-]{16,}/g, replacement: "[REDACTED_KEY]" },
  { pattern: /Bearer\s+[a-zA-Z0-9._\-]+/g, replacement: "Bearer [REDACTED]" },
  { pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: "[REDACTED_EMAIL]" },
];

const MAX_SAMPLE_LENGTH = 240;

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const { pattern, replacement } of REDACT_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result.length > MAX_SAMPLE_LENGTH
      ? `${result.slice(0, MAX_SAMPLE_LENGTH)}…`
      : result;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

function readAffectedResources(
  tool: ToolMetadata,
  args: Record<string, unknown>
): AffectedResource[] {
  const resources: AffectedResource[] = [];
  const candidates: Array<[unknown, AffectedResource["type"]]> = [
    [args.fileId, "file"],
    [args.fileIds, "file"],
    [args.path, "file"],
    [args.projectId, "project"],
    [args.artifactId, "artifact"],
    [args.url, "url"],
    [args.target, "url"],
    [args.to, "email"],
  ];
  for (const [raw, type] of candidates) {
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      raw.forEach((value) => {
        if (typeof value === "string" && value.length > 0) {
          resources.push({ type, identifier: value, displayName: value });
        }
      });
    } else if (typeof raw === "string" && raw.length > 0) {
      resources.push({ type, identifier: raw, displayName: raw });
    }
  }
  return resources;
}

function readExternalTargets(args: Record<string, unknown>): string[] | undefined {
  const value = args.url ?? args.target ?? args.urls;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return undefined;
}

function readSamplePreview(args: Record<string, unknown>): string | undefined {
  const candidate = args.content ?? args.text ?? args.body ?? args.prompt;
  if (typeof candidate !== "string") return undefined;
  return redact(candidate) as string;
}

function buildSummary(
  tool: ToolMetadata,
  args: Record<string, unknown>
): string {
  const verb = tool.isReadOnly
    ? "读取"
    : tool.riskLevel === "L3" || tool.riskLevel === "L4"
      ? "执行（高风险）"
      : "写入";
  const targets = readAffectedResources(tool, args);
  if (targets.length === 0) return `${verb} ${tool.name}`;
  const names = targets
    .slice(0, 3)
    .map((t) => t.displayName)
    .join("、");
  const suffix = targets.length > 3 ? ` 等 ${targets.length} 项` : "";
  return `${verb} ${tool.name}：${names}${suffix}`;
}

export function buildPreview(
  tool: ToolMetadata,
  args: Record<string, unknown>,
  ctx: AgentContext
): ToolCallPreview {
  const resources = readAffectedResources(tool, args);
  const sample = readSamplePreview(args);
  const external = readExternalTargets(args);
  return {
    toolId: tool.toolId,
    toolName: tool.name,
    summary: buildSummary(tool, args),
    affectedResources: resources,
    sendsToExternal:
      tool.hasExternalSideEffect ||
      Boolean(external) ||
      ctx.skill?.dataHandlingPolicy.maySendToExternal === true,
    externalTargets: external,
    isReversible: tool.isReversible,
    estimatedCost: tool.estimatedCost,
    dataTypes: dataTypesForTool(tool.toolId),
    batchCount: Array.isArray(args.fileIds)
      ? args.fileIds.length
      : Array.isArray(args.urls)
        ? args.urls.length
        : undefined,
    samplePreview: sample,
    skillName: ctx.skill?.skillId,
  };
}

function dataTypesForTool(toolId: string): string[] {
  if (toolId.startsWith("project_files.")) return ["项目资料文本"];
  if (toolId.startsWith("artifact.")) return ["Markdown 成果"];
  if (toolId.startsWith("web.")) return ["网络内容"];
  if (toolId.startsWith("quick_actions.")) return ["任务模板"];
  return ["内部数据"];
}