import crypto from "crypto";
import type { DocumentParser, ParseInput, ParseResult } from "../types";
import { extensionOf } from "./utils";
import { PIPELINE_VERSION } from "../version";

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
    const ext = extensionOf(input.filename);
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
        pipelineVersion: PIPELINE_VERSION,
        sourceKind: this.sourceKind,
        requiresVisionModel: false,
        assetCount: 0,
        parseStartedAt: startedAt,
        parseCompletedAt: endedAt,
        parseWarnings: [],
      },
    };
  }

}
