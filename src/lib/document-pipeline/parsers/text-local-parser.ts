import crypto from "crypto";
import type { DocumentParser, ParseInput, ParseResult } from "../types";

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "json",
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
  "html",
  "css",
]);

export class TextLocalParser implements DocumentParser {
  readonly parserId = "text-local";
  readonly sourceKind = "text";

  canParse(input: ParseInput): boolean {
    const ext = this.extensionOf(input.filename);
    return TEXT_EXTENSIONS.has(ext);
  }

  async parse(input: ParseInput): Promise<ParseResult> {
    const startedAt = new Date().toISOString();
    const content = input.data.toString("utf-8");
    const endedAt = new Date().toISOString();

    return {
      blocks: [
        {
          type: "text",
          id: crypto.randomUUID(),
          content,
        },
      ],
      assets: [],
      metadata: {
        parser: this.parserId,
        pipelineVersion: "0.2.0",
        sourceKind: this.sourceKind,
        requiresVisionModel: false,
        assetCount: 0,
        parseStartedAt: startedAt,
        parseCompletedAt: endedAt,
        parseWarnings: [],
      },
    };
  }

  private extensionOf(filename: string): string {
    const index = filename.lastIndexOf(".");
    return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
  }
}
