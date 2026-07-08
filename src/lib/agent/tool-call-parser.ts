/**
 * Tool-call parser / sanitizer for model-generated pseudo tool markup.
 *
 * Design goals:
 * - `sanitizeModelText`: remove any tool-call-like markup (complete or malformed)
 *   from both content and reasoning, so it never leaks to the UI.
 * - `parseToolCalls`: only recognize fully-formed, structurally valid tool calls
 *   (native tool_use is handled by the SDK; this covers DSML and XML invoke).
 */

import { toolRegistry } from "./tool-registry";
import { skillRegistry } from "./skill-registry";

export interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
}

const DSML_OPEN_TAG = /<!?\|\s*\|\s*DSML\s*\|\s*\|/i;
const DSML_CLOSE_TAG = /<\/!?\|\s*\|\s*DSML\s*\|\s*\|/i;

const XML_TOOL_CALLS_OPEN = /<tool_calls\b[^>]*>/i;

/**
 * DeepSeek / other reasoning models sometimes emit malformed markup where the
 * opening tag of a container is merged with the next tag, e.g.
 * `<tool_calls<invoke name="...">`. Normalize these common patterns so the
 * strict parser below can still execute the intended tool call.
 */
function normalizeMalformedToolMarkup(text: string): string {
  let normalized = text;
  // <tool_calls<invoke ...> -> <tool_calls><invoke ...>
  normalized = normalized.replace(/<tool_calls\s*</gi, "<tool_calls><");
  // <invoke<parameter ...> -> <invoke><parameter ...>
  normalized = normalized.replace(/<invoke\s*</gi, "<invoke><");
  // <parameter<invoke ...> -> <parameter><invoke ...>
  normalized = normalized.replace(/<parameter\s*</gi, "<parameter><");
  // <function_calls<invoke ...> -> <function_calls><invoke ...>
  normalized = normalized.replace(/<function_calls\s*</gi, "<function_calls><");
  return normalized;
}

/**
 * Strip trailing incomplete tool-call-like tag fragments. This is important for
 * streaming sanitizer: a chunk may end with `<tool_calls` or a DSML marker, and
 * we must not leak that partial markup to the UI before the next chunk completes
 * (or fails to complete) the block.
 */
function stripTrailingToolFragments(text: string): string {
  return text
    .replace(/<tool_calls\b[^>]*>?\s*$/gim, "")
    .replace(/<invoke\b[^>]*>?\s*$/gim, "")
    .replace(/<parameter\b[^>]*>?\s*$/gim, "")
    .replace(/<function_calls\b[^>]*>?\s*$/gim, "")
    .replace(/<!?\|\s*\|\s*DSML[\s\S]*$/gim, "");
}

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

function normalizeToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

function isKnownTool(name: string): boolean {
  return toolRegistry.has(name);
}

function isKnownSkill(name: string): boolean {
  return Boolean(skillRegistry.get(name));
}

/**
 * Resolve a model-emitted name to a registered tool or skill.
 * Returns null if the name cannot be mapped to anything executable.
 */
function resolveToolCall(
  name: string,
  input: Record<string, unknown>
): ParsedToolCall | null {
  const normalized = normalizeToolName(name);

  if (isKnownTool(normalized)) {
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

/**
 * Remove all tool-call-like markup from model text.
 * This is intentionally aggressive: complete blocks, malformed fragments,
 * nested tags, and standalone tags are all removed.
 */
export function sanitizeModelText(text: string): string {
  if (!text) return text;

  let cleaned = text;

  // 1. Remove complete DSML blocks (invoke / parameter / tool_calls) including
  //    nested parameter blocks, then any leftover DSML markers.
  const dsmlInvokeOpen = /<!?\|\s*\|\s*DSML\s*\|\s*\|\s*invoke\b[^>]*>/gi;
  const dsmlInvokeClose = /<\/!?\|\s*\|\s*DSML\s*\|\s*\|\s*invoke>/gi;
  const dsmlParameterOpen = /<!?\|\s*\|\s*DSML\s*\|\s*\|\s*parameter\b[^>]*>/gi;
  const dsmlParameterClose = /<\/!?\|\s*\|\s*DSML\s*\|\s*\|\s*parameter>/gi;
  const dsmlToolCallsOpen = /<!?\|\s*\|\s*DSML\s*\|\s*\|\s*tool_calls\s*>/gi;
  const dsmlToolCallsClose = /<\/!?\|\s*\|\s*DSML\s*\|\s*\|\s*tool_calls>/gi;

  cleaned = cleaned.replace(
    new RegExp(
      `${dsmlInvokeOpen.source}[\\s\\S]*?${dsmlInvokeClose.source}`,
      "gi"
    ),
    ""
  );
  cleaned = cleaned.replace(
    new RegExp(
      `${dsmlParameterOpen.source}[\\s\\S]*?${dsmlParameterClose.source}`,
      "gi"
    ),
    ""
  );
  cleaned = cleaned.replace(
    new RegExp(
      `${dsmlToolCallsOpen.source}[\\s\\S]*?${dsmlToolCallsClose.source}`,
      "gi"
    ),
    ""
  );
  // 2. Remove complete XML tool_calls / invoke / parameter blocks.
  cleaned = cleaned.replace(
    /<tool_calls\b[^>]*>[\s\S]*?<\/tool_calls>/gi,
    ""
  );
  cleaned = cleaned.replace(
    /<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi,
    ""
  );
  cleaned = cleaned.replace(
    /<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi,
    ""
  );

  // 3. Remove any trailing incomplete tag fragments that may have been split
  //    across stream chunks (e.g. "...<tool_calls" at end of a chunk). Do this
  //    before stripping leftover markers so DSML markers take their trailing
  //    content with them instead of leaving orphan tag names behind.
  cleaned = stripTrailingToolFragments(cleaned);

  // 4. Remove any leftover standalone tags (including malformed / unclosed) and
  //    stray DSML markers.
  cleaned = cleaned.replace(/<!?\|\s*\|\s*DSML\s*\|\s*\|/gi, "");
  cleaned = cleaned.replace(/<\/!?\|\s*\|\s*DSML\s*\|\s*\|/gi, "");
  cleaned = cleaned.replace(/<\/?tool_calls\b[^>]*>/gi, "");
  cleaned = cleaned.replace(/<\/?invoke\b[^>]*>/gi, "");
  cleaned = cleaned.replace(/<\/?parameter\b[^>]*>/gi, "");
  cleaned = cleaned.replace(/<\/?function_calls\b[^>]*>/gi, "");

  // 5. Collapse excessive whitespace left behind.
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

/**
 * Parse strictly-formed XML tool_calls blocks into executable tool calls.
 * Rejects bare skill ids, nested tool_calls, missing closes, and missing names.
 */
function parseXmlToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // Fast path: no tool_calls markup at all.
  if (!XML_TOOL_CALLS_OPEN.test(text)) return calls;

  // Iterate over each complete <tool_calls>...</tool_calls> block.
  const blockPattern = /<tool_calls\b[^>]*>[\s\S]*?<\/tool_calls>/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockPattern.exec(text)) !== null) {
    const block = blockMatch[0];

    // Reject nested tool_calls.
    const openCount = (block.match(/<tool_calls\b[^>]*>/gi) ?? []).length;
    const closeCount = (block.match(/<\/tool_calls>/gi) ?? []).length;
    if (openCount !== 1 || closeCount !== 1) continue;

    // Extract invoke blocks inside this tool_calls block.
    const invokePattern = /<invoke\b([^>]*)>[\s\S]*?<\/invoke>/gi;
    let invokeMatch: RegExpExecArray | null;
    while ((invokeMatch = invokePattern.exec(block)) !== null) {
      const invokeBlock = invokeMatch[0];
      const openTag = invokeMatch[1];

      const nameMatch = openTag.match(/name=["']([^"']+)["']/);
      if (!nameMatch) continue;
      const rawName = nameMatch[1];

      // Extract parameter blocks, requiring balanced parameter tags.
      const input: Record<string, unknown> = {};
      const paramPattern = /<parameter\b([^>]*)>([\s\S]*?)<\/parameter>/gi;
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = paramPattern.exec(invokeBlock)) !== null) {
        const paramOpen = paramMatch[1];
        const paramValue = paramMatch[2].trim();
        const paramNameMatch = paramOpen.match(/name=["']([^"']+)["']/);
        if (!paramNameMatch) continue;
        input[paramNameMatch[1]] = paramValue;
      }

      const resolved = resolveToolCall(rawName, input);
      if (resolved) calls.push(resolved);
    }
  }

  return calls;
}

/**
 * Parse strictly-formed DSML tool_calls blocks.
 */
function parseDsmlToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  if (!DSML_OPEN_TAG.test(text)) return calls;

  const invokePattern = new RegExp(
    `${DSML_OPEN_TAG.source}\\s*invoke\\s+name="([^"]+)"\\s*>[\\s\\S]*?${DSML_CLOSE_TAG.source}\\s*invoke\\s*>`,
    "gi"
  );

  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokePattern.exec(text)) !== null) {
    const name = invokeMatch[1];
    const invokeBody = invokeMatch[0];

    const input: Record<string, unknown> = {};
    const paramPattern = new RegExp(
      `${DSML_OPEN_TAG.source}\\s*parameter\\s+name="([^"]+)"(?:\\s+string="true")?\\s*>([\\s\\S]*?)${DSML_CLOSE_TAG.source}\\s*parameter\\s*>`,
      "gi"
    );

    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramPattern.exec(invokeBody)) !== null) {
      input[paramMatch[1]] = paramMatch[2].trim();
    }

    const resolved = resolveToolCall(name, input);
    if (resolved) calls.push(resolved);
  }

  return calls;
}

/**
 * Parse all valid tool calls from model text (DSML + strict XML invoke).
 * Malformed, nested, truncated, or bare-name markup is ignored here and
 * should be removed by `sanitizeModelText` before display.
 */
export function parseToolCalls(text: string): ParsedToolCall[] {
  if (!text) return [];
  const normalized = normalizeMalformedToolMarkup(text);
  const xmlCalls = parseXmlToolCalls(normalized);
  const dsmlCalls = parseDsmlToolCalls(normalized);

  // Deduplicate by a stable key (name + sorted input) to avoid double execution
  // when the same call appears in both XML and DSML forms.
  const seen = new Set<string>();
  const result: ParsedToolCall[] = [];
  for (const call of [...xmlCalls, ...dsmlCalls]) {
    const key = `${call.name}:${JSON.stringify(call.input, Object.keys(call.input).sort())}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(call);
  }
  return result;
}
