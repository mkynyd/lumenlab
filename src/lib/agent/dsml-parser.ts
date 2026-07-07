/**
 * DSML (DeepSeek Markup Language) parser.
 *
 * Reasoning models may emit tool-call-like markup inside `reasoning_content`
 * instead of native `tool_use` blocks. This module extracts those pseudo tool
 * calls so the backend can treat them as real tool calls, and strips the markup
 * so it does not leak into the UI.
 */

import { toolRegistry } from "./tool-registry";
import { skillRegistry } from "./skill-registry";

export interface DsmlToolCall {
  name: string;
  input: Record<string, unknown>;
}

const DSML_OPEN_TAG = /<\|\s*\|\s*DSML\s*\|\s*\|/;
const DSML_CLOSE_TAG = /<\/\|\s*\|\s*DSML\s*\|\s*\|/;
const XML_TOOL_CALLS_PATTERN = /<tool_calls\b[^>]*>[\s\S]*?<\/tool_calls>/gi;

const TOOL_NAME_ALIASES: Record<string, string> = {
  web_search: "web.search",
  search_project_files: "project_rag.search",
  search_files: "project_rag.search",
  search_project: "project_rag.search",
  list_project_files: "project_files.list",
  list_files: "project_files.list",
  read_project_file: "project_files.read",
  read_file: "project_files.read",
  read_files: "project_files.read",
  delete_file: "project_files.delete",
  delete_files: "project_files.delete",
  fetch_url: "web.fetch",
  web_fetch: "web.fetch",
  search_web: "web.search",
  save_artifact: "artifact.save",
  save_file: "artifact.save",
  list_artifacts: "artifact.list",
  arxiv_search: "arxiv.search",
  arxiv_read: "arxiv.read",
  arxiv_fetch: "arxiv.fetch",
  add_reference: "reference.add",
  list_references: "reference.list",
  attach_reference: "reference.attach",
  format_references: "reference.format",
  reference_format: "reference.format",
  activate_skill: "skill.activate",
};

function normalizeToolName(name: string) {
  return TOOL_NAME_ALIASES[name] ?? name;
}

function isKnownTool(name: string): boolean {
  return toolRegistry.has(name);
}

function isKnownSkill(name: string): boolean {
  return Boolean(skillRegistry.get(name));
}

/**
 * 把模型可能输出的名字解析为真实 tool/skill 调用。
 * 如果名字无法对应到已注册工具或已注册 skill，则返回 null（应丢弃，避免执行时抛错）。
 */
function resolveToolCall(name: string, input: Record<string, unknown>): DsmlToolCall | null {
  const normalized = normalizeToolName(name);

  if (isKnownTool(normalized)) {
    // 对 skill.activate 还要校验目标 skill 真实存在
    if (normalized === "skill.activate") {
      const target = input.name ?? input.skill;
      if (typeof target === "string" && !isKnownSkill(target)) {
        return null;
      }
    }
    return { name: normalized, input };
  }

  if (isKnownSkill(normalized)) {
    return { name: "skill.activate", input: { name: normalized, ...input } };
  }

  return null;
}

function extractXmlToolCalls(text: string): DsmlToolCall[] {
  const calls: DsmlToolCall[] = [];
  const blocks = text.match(XML_TOOL_CALLS_PATTERN) ?? [];

  for (const block of blocks) {
    const blockCalls: DsmlToolCall[] = [];

    const invokePattern = /<invoke\b[^>]*name=["']([^"']+)["'][^>]*>[\s\S]*?<\/invoke>/gi;
    let invokeMatch: RegExpExecArray | null;
    while ((invokeMatch = invokePattern.exec(block)) !== null) {
      const input: Record<string, unknown> = {};
      const invokeBody = invokeMatch[0];
      const paramPattern = /<parameter\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/parameter>/gi;
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = paramPattern.exec(invokeBody)) !== null) {
        input[paramMatch[1]] = paramMatch[2].trim();
      }
      const resolved = resolveToolCall(invokeMatch[1], input);
      if (resolved) blockCalls.push(resolved);
    }

    if (blockCalls.length === 0) {
      const bare = block
        .replace(/<\/?tool_calls\b[^>]*>/gi, "")
        .trim();
      // skill / tool id 允许字母、数字、下划线、连字符、点号
      if (/^[a-z0-9][a-z0-9_.-]*$/i.test(bare)) {
        const resolved = resolveToolCall(bare, {});
        if (resolved) blockCalls.push(resolved);
      }
    }

    calls.push(...blockCalls);
  }

  return calls;
}

/**
 * Remove DSML tool-call blocks from reasoning text.
 */
export function stripDsmlToolCalls(text: string): string {
  if (!text) return text;

  // Strip entire outer <tool_calls>...</tool_calls> blocks.
  const toolCallsPattern = new RegExp(
    `${DSML_OPEN_TAG.source}\\s*tool_calls\\s*>[\\s\\S]*?${DSML_CLOSE_TAG.source}\\s*tool_calls\\s*>`,
    "g"
  );

  return text
    .replace(toolCallsPattern, "")
    .replace(XML_TOOL_CALLS_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract tool calls encoded in DSML markup.
 *
 * Supported format (from observed DeepSeek reasoning output):
 *   <| | DSML | | tool_calls>
 *     <| | DSML | | invoke name="web_search">
 *       <| | DSML | | parameter name="query" string="true">...query...</| | DSML | | parameter>
 *     </| | DSML | | invoke>
 *   </| | DSML | | tool_calls>
 */
export function extractDsmlToolCalls(text: string): DsmlToolCall[] {
  if (!text) return [];
  const xmlCalls = extractXmlToolCalls(text);
  if (!DSML_OPEN_TAG.test(text)) return xmlCalls;

  const toolCalls: DsmlToolCall[] = [];

  // Match each <invoke>...</invoke> block.
  const invokePattern = new RegExp(
    `${DSML_OPEN_TAG.source}\\s*invoke\\s+name="([^"]+)"\\s*>[\\s\\S]*?${DSML_CLOSE_TAG.source}\\s*invoke\\s*>`,
    "g"
  );

  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokePattern.exec(text)) !== null) {
    const name = invokeMatch[1];
    const invokeBody = invokeMatch[0];

    const input: Record<string, unknown> = {};
    const paramPattern = new RegExp(
      `${DSML_OPEN_TAG.source}\\s*parameter\\s+name="([^"]+)"(?:\\s+string="true")?\\s*>([\\s\\S]*?)${DSML_CLOSE_TAG.source}\\s*parameter\\s*>`,
      "g"
    );

    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramPattern.exec(invokeBody)) !== null) {
      const paramName = paramMatch[1];
      const rawValue = paramMatch[2].trim();
      input[paramName] = rawValue;
    }

    const resolved = resolveToolCall(name, input);
    if (resolved) toolCalls.push(resolved);
  }

  return [...toolCalls, ...xmlCalls];
}
