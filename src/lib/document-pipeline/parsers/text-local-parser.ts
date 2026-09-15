import crypto from "crypto";
import type { DocumentBlock, DocumentParser, ParseInput, ParseResult } from "../types";
import { extensionOf } from "./utils";
import { markdownToBlocks } from "./markdown-to-blocks";
import { PIPELINE_VERSION } from "../version";

// .md 作为可信 Markdown 解析，保留标题、表格、公式等结构；
// 展示层再经 react-markdown + sanitize 渲染，不执行危险标签。
const MARKDOWN_EXTENSIONS = new Set(["md"]);

// 源代码文件用代码查看器展示（等宽 + 高亮），不作为 Markdown 执行。
const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "c",
  "cpp",
  "h",
  "java",
  "sql",
  "css",
  "html",
]);

// 纯文本按原样展示，Markdown 特殊字符全部转义。
const TEXT_EXTENSIONS = new Set(["txt", "csv", "json"]);

export class TextLocalParser implements DocumentParser {
  readonly parserId = "text-local";
  readonly sourceKind = "text";

  canParse(input: ParseInput): boolean {
    const ext = extensionOf(input.filename);
    return (
      MARKDOWN_EXTENSIONS.has(ext) ||
      CODE_EXTENSIONS.has(ext) ||
      TEXT_EXTENSIONS.has(ext)
    );
  }

  async parse(input: ParseInput): Promise<ParseResult> {
    const startedAt = new Date().toISOString();
    const content = input.data.toString("utf-8");
    const endedAt = new Date().toISOString();
    const ext = extensionOf(input.filename);

    let blocks: DocumentBlock[];
    if (MARKDOWN_EXTENSIONS.has(ext)) {
      blocks = flattenMarkdownImages(markdownToBlocks(content));
    } else if (CODE_EXTENSIONS.has(ext)) {
      blocks = [
        {
          type: "code",
          id: crypto.randomUUID(),
          language: ext,
          content,
        },
      ];
    } else {
      blocks = [
        {
          type: "text",
          id: crypto.randomUUID(),
          content,
        },
      ];
    }

    return {
      blocks,
      assets: [],
      metadata: {
        parser: this.parserId,
        pipelineVersion: PIPELINE_VERSION,
        sourceKind: this.sourceKind,
        assetCount: 0,
        parseStartedAt: startedAt,
        parseCompletedAt: endedAt,
        parseWarnings: [],
      },
    };
  }
}

// .md 里的本地图片没有对应的解析资源（不上传、不落 FileAssetResource），
// 保留为纯文本行避免预览出现裂图；原文引用仍可核对。
function flattenMarkdownImages(blocks: DocumentBlock[]): DocumentBlock[] {
  return blocks.map((block) => {
    if (block.type !== "image") return block;
    const alt = block.altText || "";
    return {
      type: "text",
      id: block.id,
      content: `![${alt}](${block.relativePath})`,
    };
  });
}
