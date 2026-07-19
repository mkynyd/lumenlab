import { measureText, measureTextLines } from "@/lib/text-layout";

/**
 * Estimate the rendered height of a chat message without touching the DOM.
 *
 * This is intentionally approximate: markdown block-level elements (code blocks,
 * lists, Mermaid, math) add height that depends on the final React render. We
 * account for them with conservative heuristics so the virtual list gets a much
 * better first guess than the previous fixed 120px.
 */

const BODY_FONT_SIZE = 16; // markdown-body uses 1rem = 16px
const BODY_LINE_HEIGHT = 28; // 16px * 1.75
const PARAGRAPH_MARGIN = 12.75; // 0.75em at body size
const CODE_FONT_SIZE = 13; // pre code uses 0.88em
const CODE_LINE_HEIGHT = 21;
const CODE_PADDING_Y = 28; // 0.85em top + bottom inside pre
const CODE_PADDING_X = 16; // 1em left + right inside pre
const MERMAID_MIN_HEIGHT = 240;
const LUMENFLOW_MIN_HEIGHT = 156;
const OUTER_PADDING_Y = 32; // py-4
const AVATAR_GAP = 12;
const AVATAR_WIDTH = 32;
const MESSAGE_LIST_PADDING_X = 32; // px-4 * 2 (mobile) or px-6 * 2 (md)
const USER_BUBBLE_MAX_RATIO = 0.85;
const USER_BUBBLE_PADDING_X = 28; // px-3.5 * 2
const USER_BUBBLE_PADDING_Y = 20; // py-2.5 * 2

export interface MessageHeightEstimateInput {
  content: string;
  role: "user" | "assistant" | "system";
  reasoningContent?: string | null;
  tokenCount?: number | null;
  sourceCount?: number;
  isStreaming?: boolean;
  isReasoningOpen?: boolean;
}

export interface MessageLayoutContext {
  containerWidth: number;
}

function getAssistantTextWidth(context: MessageLayoutContext): number {
  const available =
    context.containerWidth -
    MESSAGE_LIST_PADDING_X -
    AVATAR_WIDTH -
    AVATAR_GAP;
  return Math.max(240, available);
}

function getUserTextWidth(context: MessageLayoutContext): number {
  const available =
    context.containerWidth -
    MESSAGE_LIST_PADDING_X -
    AVATAR_WIDTH -
    AVATAR_GAP;
  return available * USER_BUBBLE_MAX_RATIO - USER_BUBBLE_PADDING_X;
}

function extractCodeBlocks(content: string): { language?: string; code: string }[] {
  const blocks: { language?: string; code: string }[] = [];
  const fenced = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = fenced.exec(content)) !== null) {
    blocks.push({ language: match[1], code: match[2].replace(/\n$/, "") });
  }
  return blocks;
}

function extractMermaidBlocks(content: string): string[] {
  const blocks: string[] = [];
  const fenced = /```mermaid\n([\s\S]*?)```/g;
  let match;
  while ((match = fenced.exec(content)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function extractLumenFlowBlocks(content: string): string[] {
  const blocks: string[] = [];
  const fenced = /```lumenflow\n([\s\S]*?)```/g;
  let match;
  while ((match = fenced.exec(content)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function extractInlineCode(content: string): string[] {
  const matches = content.match(/`([^`]+)`/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

function estimateCodeBlockHeight(code: string, textWidth: number): number {
  const wrapped = measureTextLines(code, {
    maxWidth: textWidth - CODE_PADDING_X,
    fontSize: CODE_FONT_SIZE,
    lineHeight: CODE_LINE_HEIGHT,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    whiteSpace: "pre-wrap",
  });
  return wrapped.height + CODE_PADDING_Y + PARAGRAPH_MARGIN * 2;
}

function estimateMermaidBlockHeight(code: string): number {
  // Mermaid height depends on the rendered diagram. Use a conservative minimum
  // plus a small per-line bonus for very large definitions.
  const lines = code.split("\n").length;
  return Math.max(MERMAID_MIN_HEIGHT, Math.min(480, lines * 28 + 80));
}

function estimateLumenFlowBlockHeight(code: string): number {
  try {
    const parsed = JSON.parse(code) as { direction?: string; nodes?: unknown[] };
    const nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 1;
    if (parsed.direction === "TB") return Math.max(LUMENFLOW_MIN_HEIGHT, nodeCount * 88 + 56);
    return Math.max(LUMENFLOW_MIN_HEIGHT, Math.min(260, nodeCount * 44 + 96));
  } catch {
    return estimateCodeBlockHeight(code, 480);
  }
}

/**
 * Strip markdown down to readable prose so Pretext can measure the body text.
 * Code blocks, math, and Mermaid are removed here and measured separately.
 */
function extractProseText(content: string): string {
  return (
    content
      // Remove fenced code blocks.
      .replace(/```[\s\S]*?```/g, "\n")
      // Remove block math.
      .replace(/\$\$[\s\S]*?\$\$/g, "")
      // Remove inline math.
      .replace(/\$[^$\n]+\$/g, "")
      // Remove images.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // Keep link text only.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Remove HTML tags.
      .replace(/<[^>]+>/g, "")
      // Replace heading markers with newlines (they add vertical space).
      .replace(/^#{1,6}\s+/gm, "\n")
      // Remove list markers.
      .replace(/^[\s]*[-*+][\s]+/gm, "")
      .replace(/^[\s]*\d+\.[\s]+/gm, "")
      // Normalize whitespace.
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function estimateProseHeight(content: string, textWidth: number): number {
  const prose = extractProseText(content);
  if (!prose) return 0;
  const { height } = measureText(prose, {
    maxWidth: textWidth,
    fontSize: BODY_FONT_SIZE,
    lineHeight: BODY_LINE_HEIGHT,
    fontFamily: '"Noto Sans SC", sans-serif',
    wordBreak: "normal",
  });
  // Add paragraph margins between visual blocks. We approximate the number of
  // block breaks from empty lines and block-level markers in the original.
  const blockBreaks = (content.match(/\n\s*\n/g) ?? []).length;
  const headingCount = (content.match(/^#{1,6}\s+/gm) ?? []).length;
  const listCount = (content.match(/^[\s]*[-*+\d][.)\s]/gm) ?? []).length;
  const extraMargin = (blockBreaks + headingCount + listCount) * PARAGRAPH_MARGIN;
  return height + extraMargin;
}

function estimateReasoningHeight(reasoning: string, textWidth: number): number {
  const base = 28; // trigger row + margin
  const { height } = measureText(reasoning, {
    maxWidth: textWidth,
    fontSize: 12, // reasoning uses text-xs
    lineHeight: 18,
    fontFamily: '"Noto Sans SC", sans-serif',
    whiteSpace: "pre-wrap",
  });
  return base + height + 16; // inner padding
}

export function estimateMessageHeight(
  input: MessageHeightEstimateInput,
  context: MessageLayoutContext
): number {
  if (input.role === "system") return 0;

  const textWidth =
    input.role === "user"
      ? getUserTextWidth(context)
      : getAssistantTextWidth(context);

  let height = OUTER_PADDING_Y;

  if (input.reasoningContent?.trim() && input.isReasoningOpen) {
    height += estimateReasoningHeight(input.reasoningContent, textWidth);
  } else if (input.reasoningContent?.trim()) {
    height += 28; // collapsed reasoning trigger row
  }

  const proseHeight = estimateProseHeight(input.content, textWidth);
  height += proseHeight;

  const codeBlocks = extractCodeBlocks(input.content);
  const mermaidBlocks = extractMermaidBlocks(input.content);
  const lumenFlowBlocks = extractLumenFlowBlocks(input.content);
  const nonDiagramCode = codeBlocks.filter(
    (block) => block.language !== "mermaid" && block.language !== "lumenflow"
  );

  for (const block of nonDiagramCode) {
    height += estimateCodeBlockHeight(block.code, textWidth);
  }

  for (const block of mermaidBlocks) {
    height += estimateMermaidBlockHeight(block);
  }

  for (const block of lumenFlowBlocks) {
    height += estimateLumenFlowBlockHeight(block);
  }

  // Inline code generally does not change line height, but give a tiny buffer
  // when there is a lot of it.
  const inlineCode = extractInlineCode(input.content);
  if (inlineCode.length > 5) {
    height += inlineCode.length * 1.5;
  }

  if (input.role === "user" && proseHeight > 0) {
    height += USER_BUBBLE_PADDING_Y;
  }

  if (input.tokenCount != null) {
    height += 20; // token count row
  }

  if (input.sourceCount && input.sourceCount > 0) {
    height += 48 + Math.ceil(Math.min(input.sourceCount, 5) / 2) * 30;
  }

  // Streaming placeholder is roughly the same as a short message; no extra.
  if (!input.content.trim() && input.isStreaming) {
    height += 80;
  }

  return Math.max(80, Math.round(height));
}
