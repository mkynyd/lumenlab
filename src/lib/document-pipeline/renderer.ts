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
      return `${block.markdown}\n\n> ${block.caption}`;
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
  const alt = block.altText || "image";
  const imageLine = `![${alt}](${block.relativePath})`;
  const quote = renderImageAnalysisQuote(block);
  return quote ? `${imageLine}\n\n${quote}` : imageLine;
}

function renderImageAnalysisQuote(block: ImageBlock): string | undefined {
  if (block.analysisStatus === "failed") {
    return `> 视觉理解失败${block.skipReason ? `：${block.skipReason}` : ""}`;
  }

  if (block.analysisStatus === "skipped") {
    return `> 已跳过视觉理解${block.skipReason ? `：${block.skipReason}` : ""}`;
  }

  const text = block.visionSummary ?? block.visionText ?? block.extractedText;
  if (text) {
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (block.confidence !== undefined && block.confidence < 0.5) {
    return `> 置信度较低（${Math.round(block.confidence * 100)}%），请人工核对。`;
  }

  return undefined;
}
