import type { DocumentBlock, ImageBlock } from "./types";

export function renderDocumentToMarkdown(blocks: DocumentBlock[]): string {
  return blocks.map(renderBlock).join("\n\n").trim();
}

function renderBlock(block: DocumentBlock): string {
  switch (block.type) {
    case "text":
      return block.content;

    case "heading":
      return `${"#".repeat(block.level)} ${block.content}`;

    case "table": {
      if (!block.caption) {
        return block.markdown;
      }
      return `${block.markdown}\n\n*${block.caption}*`;
    }

    case "formula":
      return `$$${block.content}$$`;

    case "code": {
      const language = block.language ?? "";
      return `\`\`\`${language}\n${block.content}\n\`\`\``;
    }

    case "page-break":
      return "---";

    case "image":
      return renderImage(block);

    default:
      return "";
  }
}

function renderImage(block: ImageBlock): string {
  const alt = block.altText || "";
  const imageLine = `![${alt}](${block.relativePath})`;
  const quote = renderImageAnalysisQuote(block);
  return quote ? `${imageLine}\n\n${quote}` : imageLine;
}

function renderImageAnalysisQuote(block: ImageBlock): string | undefined {
  if (block.analysisStatus === "failed") {
    return `> 图像解析失败${block.skipReason ? `：${block.skipReason}` : ""}`;
  }

  if (block.analysisStatus === "skipped") {
    return undefined;
  }

  const lines: string[] = [];
  if (block.visionSummary) {
    lines.push(`图像解析：${block.visionSummary}`);
  }
  if (block.visionText) {
    lines.push(`图中文字：${block.visionText}`);
  }
  if (block.extractedText && block.extractedText !== block.visionText) {
    lines.push(`结构化内容：${block.extractedText}`);
  }

  if (lines.length > 0) {
    return lines
      .flatMap((line) => line.split("\n"))
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (block.confidence !== undefined && block.confidence < 0.7) {
    return `> 注意：低置信度，关键数字/公式建议核对原文。`;
  }

  return undefined;
}
