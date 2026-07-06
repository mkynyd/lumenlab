import type { DocumentBlock, ImageBlock } from "./types";

export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export function renderDocumentToMarkdown(blocks: DocumentBlock[]): string {
  return blocks.map(renderBlock).join("\n\n");
}

function escapeMarkdown(
  text: string,
  options: { escapeBackticks?: boolean } = {}
): string {
  const { escapeBackticks = true } = options;
  const pattern = escapeBackticks
    ? /([\\`*_{}\[\]()#|!])/g
    : /([\\*_{}\[\]()#|!])/g;
  return text.replace(pattern, "\\$1");
}

function encodeMarkdownUrl(path: string): string {
  // Encode characters that can break Markdown link syntax while preserving
  // forward slashes used as path separators.
  return path.replace(
    /[()\[\] ?#&<>]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function renderBlock(block: DocumentBlock): string {
  switch (block.type) {
    case "text":
      return escapeMarkdown(block.content);

    case "heading": {
      const level = Math.max(1, Math.min(6, block.level));
      return `${"#".repeat(level)} ${escapeMarkdown(block.content)}`;
    }

    case "table": {
      if (!block.caption) {
        return block.markdown;
      }
      return `${block.markdown}\n\n*${escapeMarkdown(block.caption)}*`;
    }

    case "formula":
      return `$$${escapeMarkdown(block.content)}$$`;

    case "code": {
      const language = block.language ?? "";
      const content = escapeMarkdown(block.content, { escapeBackticks: false });
      return `\`\`\`${language}\n${content}\n\`\`\``;
    }

    case "page-break":
      return "---";

    case "image":
      return renderImage(block);

    default: {
      const _exhaustive: never = block;
      throw new Error(
        `Unsupported block type: ${String((_exhaustive as Record<string, unknown>).type)}`
      );
    }
  }
}

function renderImage(block: ImageBlock): string {
  const alt = block.altText || "";
  const imageLine = `![${escapeMarkdown(alt)}](${encodeMarkdownUrl(block.relativePath)})`;
  const quote = renderImageAnalysisQuote(block);
  return quote ? `${imageLine}\n\n${quote}` : imageLine;
}

function renderImageAnalysisQuote(block: ImageBlock): string | undefined {
  if (block.analysisStatus === "failed") {
    const skipReason = block.skipReason
      ? block.skipReason.replace(/\n/g, " ")
      : "";
    return `> 图像解析失败${skipReason ? `：${escapeMarkdown(skipReason)}` : ""}`;
  }

  if (block.analysisStatus === "skipped") {
    return undefined;
  }

  const lines: string[] = [];
  if (block.visionSummary) {
    lines.push(`图像解析：${escapeMarkdown(block.visionSummary)}`);
  }
  if (block.visionText) {
    lines.push(`图中文字：${escapeMarkdown(block.visionText)}`);
  }
  if (block.extractedText && block.extractedText !== block.visionText) {
    lines.push(`结构化内容：${escapeMarkdown(block.extractedText)}`);
  }

  if (
    block.confidence !== undefined &&
    block.confidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    lines.push("注意：低置信度，关键数字/公式建议核对原文。");
  }

  if (lines.length > 0) {
    return lines
      .flatMap((line) => line.split("\n"))
      .map((line) => `> ${line}`)
      .join("\n");
  }

  return undefined;
}
