import type { TaskProfile } from "./skill-router";
import { isSafePublicHttpUrl } from "@/lib/tools/web/fetch";
import {
  aggregateSources,
  extractSourcesFromToolResult,
  type AgentSource,
} from "./sources";

export type { TaskProfile };

export type ToolLoopStopReason =
  | "round_limit"
  | "duplicate_tool_call"
  | "no_progress"
  | "consecutive_failures"
  | "model_ceased_calling_tools"
  | "tool_budget_exhausted";

/** 工具调用失败的分类，决定模型和编排器如何恢复 */
export type FailureCategory =
  | "invalid_params"    // 参数错误 — 可修正后重试一次
  | "transient"          // 网络/超时 — 可换来源或降级
  | "permission"         // 权限拒绝 — 不得原样重试
  | "not_found"          // 资源不存在 — 放弃该路径
  | "rate_limited"       // 频率限制 — 等待后可重试
  | "internal_error";    // 服务端内部错误 — 降级处理

export function classifyFailure(error: string): FailureCategory {
  const normalized = error.toLowerCase();
  if (normalized.includes("rate") && (normalized.includes("limit") || normalized.includes("throttle"))) {
    return "rate_limited";
  }
  if (normalized.includes("permission") || normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("401") || normalized.includes("403")) {
    return "permission";
  }
  if (normalized.includes("not found") || normalized.includes("不存在") || normalized.includes("404") || normalized.includes("does not exist")) {
    return "not_found";
  }
  if (normalized.includes("invalid") || normalized.includes("parameter") || normalized.includes("bad request") || normalized.includes("400") || normalized.includes("422")) {
    return "invalid_params";
  }
  if (normalized.includes("timeout") || normalized.includes("network") || normalized.includes("econnrefused") || normalized.includes("econnreset") || normalized.includes("dns")) {
    return "transient";
  }
  return "internal_error";
}

/** 用于追踪的连续失败检测 */
export const CONSECUTIVE_FAILURE_THRESHOLD = 3; // 连续失败超过此次数则强制停止

export interface FailureRecord {
  toolId: string;
  category: FailureCategory;
  round: number;
}

export interface ToolLoopRecord {
  toolId: string;
  args: Record<string, unknown>;
  producedNewContent: boolean;
}

export type ToolId =
  | "plan.update"
  | "project_files.list"
  | "project_files.read"
  | "project_files.delete"
  | "project_rag.search"
  | "web.search"
  | "web.fetch"
  | "arxiv.search"
  | "arxiv.read"
  | "arxiv.fetch"
  | "reference.add"
  | "reference.list"
  | "reference.attach"
  | "reference.format"
  | "artifact.save"
  | "artifact.list"
  | "artifact.export_docx";

export interface PlannedToolCall {
  id: string;
  name: ToolId;
  input: Record<string, unknown>;
}

export interface ToolPlanningInput {
  prompt: string;
  profile: TaskProfile;
  projectId?: string | null;
  selectedFileIds?: string[];
  webAccessRecommended?: boolean;
}

export type PlannedToolRunResult =
  | { status: "succeeded"; summary: Record<string, unknown> }
  | { status: "failed"; error: string; summary?: Record<string, unknown> }
  | { status: "pending_approval"; executionId: string };

export interface ExecutePlannedToolCallsInput {
  profile: TaskProfile;
  plannedCalls: PlannedToolCall[];
  runTool: (call: PlannedToolCall) => Promise<PlannedToolRunResult>;
}

export interface ExecutePlannedToolCallsResult {
  contextMessage: string;
  sources: AgentSource[];
  results: Array<{
    call: PlannedToolCall;
    status: "succeeded" | "failed";
    summary?: Record<string, unknown>;
    error?: string;
  }>;
  stopReason: ToolLoopStopReason | null;
  pendingExecutionIds: string[];
}

export interface ToolLoopState {
  profile: TaskProfile;
  round: number;
  history: ToolLoopRecord[];
  /** 最近连续失败记录（用于检测是否达到阈值） */
  recentFailures: FailureRecord[];
}

const TOOL_ROUND_LIMITS: Record<TaskProfile, number> = {
  simple: 2,
  rag: 4,
  research: 6,
  workflow: 10,
};

export function getToolRoundLimit(profile: TaskProfile): number {
  return TOOL_ROUND_LIMITS[profile];
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractPublicUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s<>"')\]}，。；、]+/g) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[),.;!?]+$/, "")))]
    .filter((url) => isSafePublicHttpUrl(url))
    .slice(0, 3);
}

function extractArxivIds(text: string): string[] {
  const normalized = normalize(text);
  const idMatches = normalized.match(/arxiv[:\s]+(\d{4}\.\d{4,5}(?:v\d+)?)/g) ?? [];
  const urlMatches = normalized.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/g) ?? [];
  const ids = [...idMatches, ...urlMatches]
    .map((match) => match.replace(/arxiv[:\s]+/, "").replace(/arxiv\.org\/abs\//, ""))
    .filter(Boolean);
  return [...new Set(ids)].slice(0, 2);
}

function hasKeyword(text: string, keywords: Array<string | RegExp>) {
  const n = normalize(text);
  return keywords.some((keyword) =>
    typeof keyword === "string" ? n.includes(keyword) : keyword.test(n)
  );
}

export function buildPlannedToolCalls(input: ToolPlanningInput): PlannedToolCall[] {
  const calls: PlannedToolCall[] = [];
  const prompt = input.prompt;

  // 1. arXiv papers -> arxiv.read (takes precedence over web.fetch for arxiv URLs)
  const arxivIds = extractArxivIds(prompt);
  arxivIds.forEach((arxivId, index) => {
    calls.push({
      id: `planned-arxiv-read-${index + 1}`,
      name: "arxiv.read",
      input: { arxivId },
    });
  });

  // 2. Explicit public URLs -> web.fetch (skip arxiv URLs already handled above)
  const urls = extractPublicUrls(prompt).filter((url) => !url.includes("arxiv.org"));
  urls.forEach((url, index) => {
    calls.push({
      id: `planned-web-fetch-${index + 1}`,
      name: "web.fetch",
      input: { url },
    });
  });

  // 3. Explicit web search request -> web.search
  if (
    !urls.length &&
    !arxivIds.length &&
    hasKeyword(prompt, [/搜索.*网络/, /联网.*搜索/, /网上.*搜索/, /web search/, /search the web/])
  ) {
    calls.push({
      id: "planned-web-search-1",
      name: "web.search",
      input: { query: prompt, maxResults: 5 },
    });
  }

  // 4. Project file listing intent -> project_files.list
  if (
    input.projectId &&
    hasKeyword(prompt, [/列出.*资料/, /列出.*文件/, /有哪些.*文件/, /文件.*列表/])
  ) {
    calls.push({
      id: "planned-project-files-list-1",
      name: "project_files.list",
      input: { projectId: input.projectId },
    });
  }

  // 5. Reference listing intent -> reference.list
  if (
    input.projectId &&
    hasKeyword(prompt, [/列出.*引用/, /参考.*文献/, /references/])
  ) {
    calls.push({
      id: "planned-reference-list-1",
      name: "reference.list",
      input: { projectId: input.projectId },
    });
  }

  // 6. Selected project files -> project_files.read
  if (input.projectId && input.selectedFileIds?.length) {
    [...new Set(input.selectedFileIds)].slice(0, 5).forEach((fileId, index) => {
      calls.push({
        id: `planned-project-file-read-${index + 1}`,
        name: "project_files.read",
        input: {
          projectId: input.projectId,
          fileId,
          maxChars: 12000,
        },
      });
    });
    return calls;
  }

  // 8. Project material task without selected files -> project_rag.search
  if (input.projectId && input.profile !== "simple") {
    calls.push({
      id: "planned-project-rag-search-1",
      name: "project_rag.search",
      input: {
        projectId: input.projectId,
        query: prompt,
        maxResults: 5,
      },
    });
  }

  return calls;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toolCallKey(record: ToolLoopRecord) {
  return `${record.toolId}:${stableStringify(record.args)}`;
}

function hasDuplicateToolCall(history: ToolLoopRecord[]) {
  const seen = new Set<string>();
  for (const item of history) {
    const key = toolCallKey(item);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function hasConsecutiveNoProgress(history: ToolLoopRecord[]) {
  if (history.length < 2) return false;
  return history.slice(-2).every((item) => !item.producedNewContent);
}

function hasConsecutiveFailures(failures: FailureRecord[]): boolean {
  if (failures.length < CONSECUTIVE_FAILURE_THRESHOLD) return false;
  // 检查最近 N 条是否连续（按 round 连续）
  const recent = failures.slice(-CONSECUTIVE_FAILURE_THRESHOLD);
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].round !== recent[i - 1].round + 1) return false;
  }
  return true;
}

export function shouldStopToolLoop(
  state: ToolLoopState
): { stop: true; reason: ToolLoopStopReason } | { stop: false } {
  if (state.round >= getToolRoundLimit(state.profile)) {
    return { stop: true, reason: "round_limit" };
  }
  if (hasDuplicateToolCall(state.history)) {
    return { stop: true, reason: "duplicate_tool_call" };
  }
  if (hasConsecutiveNoProgress(state.history)) {
    return { stop: true, reason: "no_progress" };
  }
  if (hasConsecutiveFailures(state.recentFailures)) {
    return { stop: true, reason: "consecutive_failures" };
  }
  return { stop: false };
}

export function toolResultProducedNewContent(result: Record<string, unknown>): boolean {
  if (typeof result.error === "string") return false;
  if (Array.isArray(result.hits)) return result.hits.length > 0;
  if (Array.isArray(result.files)) return result.files.length > 0;
  if (typeof result.text === "string") return result.text.trim().length > 0;
  if (typeof result.markdown === "string") return result.markdown.trim().length > 0;
  if (typeof result.body === "string") return result.body.trim().length > 0;
  if (typeof result.id === "string") return true;
  return Object.keys(result).length > 0;
}

function summarizeToolResult(call: PlannedToolCall, result: Record<string, unknown>) {
  const compact = JSON.stringify(result, null, 2);
  return `## ${call.name}\n\n参数：${JSON.stringify(call.input)}\n\n结果：\n${compact.slice(0, 16000)}`;
}

export async function executePlannedToolCalls(
  input: ExecutePlannedToolCallsInput
): Promise<ExecutePlannedToolCallsResult> {
  const results: ExecutePlannedToolCallsResult["results"] = [];
  const sources: AgentSource[] = [];
  const history: ToolLoopRecord[] = [];
  const recentFailures: FailureRecord[] = [];
  let stopReason: ToolLoopStopReason | null = null;
  const pendingExecutionIds: string[] = [];

  for (let index = 0; index < input.plannedCalls.length; index += 1) {
    const stop = shouldStopToolLoop({
      profile: input.profile,
      round: index,
      history,
      recentFailures,
    });
    if (stop.stop) {
      stopReason = stop.reason;
      break;
    }

    const call = input.plannedCalls[index];
    const executed = await input.runTool(call);
    if (executed.status === "succeeded") {
      results.push({ call, status: "succeeded", summary: executed.summary });
      sources.push(...extractSourcesFromToolResult(call.name, executed.summary));
      history.push({
        toolId: call.name,
        args: call.input,
        producedNewContent: toolResultProducedNewContent(executed.summary),
      });
    } else if (executed.status === "pending_approval") {
      pendingExecutionIds.push(executed.executionId);
      break;
    } else {
      const category = classifyFailure(executed.error);
      results.push({
        call,
        status: "failed",
        summary: executed.summary,
        error: executed.error,
      });
      history.push({
        toolId: call.name,
        args: call.input,
        producedNewContent: false,
      });
      recentFailures.push({ toolId: call.name, category, round: index });
    }
  }

  const contextSections = results
    .filter((item) => item.status === "succeeded" && item.summary)
    .map((item) => summarizeToolResult(item.call, item.summary ?? {}));
  const contextMessage = contextSections.length
    ? `# Agent 工具结果\n\n${contextSections.join("\n\n")}\n\n请直接基于以上工具结果回答用户问题。工具已经执行完毕，不要重复描述“我将调用/获取”等计划；正文不要插入引用标记；来源会在回答底部单独展示。`
    : "";

  return {
    contextMessage,
    sources: aggregateSources(sources),
    results,
    stopReason,
    pendingExecutionIds,
  };
}
