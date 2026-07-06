/**
 * DSML (DeepSeek Markup Language) parser.
 *
 * Reasoning models may emit tool-call-like markup inside `reasoning_content`
 * instead of native `tool_use` blocks. This module extracts those pseudo tool
 * calls so the backend can treat them as real tool calls, and strips the markup
 * so it does not leak into the UI.
 */

export interface DsmlToolCall {
  name: string;
  input: Record<string, unknown>;
}

const DSML_OPEN_TAG = /<\|\s*\|\s*DSML\s*\|\s*\|/;
const DSML_CLOSE_TAG = /<\/\|\s*\|\s*DSML\s*\|\s*\|/;

/**
 * Remove DSML tool-call blocks from reasoning text.
 */
export function stripDsmlToolCalls(text: string): string {
  if (!text || !DSML_OPEN_TAG.test(text)) return text;

  // Strip entire outer <tool_calls>...</tool_calls> blocks.
  const toolCallsPattern = new RegExp(
    `${DSML_OPEN_TAG.source}\\s*tool_calls\\s*>[\\s\\S]*?${DSML_CLOSE_TAG.source}\\s*tool_calls\\s*>`,
    "g"
  );

  return text
    .replace(toolCallsPattern, "")
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
  if (!text || !DSML_OPEN_TAG.test(text)) return [];

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

    if (name) {
      toolCalls.push({ name, input });
    }
  }

  return toolCalls;
}
