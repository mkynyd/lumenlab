// @vitest-environment node

import { describe, it, expect } from "vitest";
import { TextLocalParser } from "../parsers/text-local-parser";
import type { ParseInput } from "../types";

function makeInput(filename: string, mimeType: string, data: Buffer): ParseInput {
  return {
    userId: "u1",
    fileAssetId: "f1",
    filename,
    mimeType,
    data,
    apiKeys: {},
  };
}

describe("TextLocalParser", () => {
  it("parses a text file into a single text block", async () => {
    const parser = new TextLocalParser();
    const input = makeInput("notes.md", "text/markdown", Buffer.from("# Hello\n\nWorld"));

    expect(parser.canParse(input)).toBe(true);

    const result = await parser.parse(input);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("text");
    expect((result.blocks[0] as Extract<typeof result.blocks[number], { type: "text" }>).content).toBe(
      "# Hello\n\nWorld"
    );
    expect(result.assets).toHaveLength(0);
    expect(result.metadata.parser).toBe("text-local");
    expect(result.metadata.sourceKind).toBe("text");
    expect(result.metadata.pipelineVersion).toBe("0.2.0");
    expect(result.metadata.requiresVisionModel).toBe(false);
    expect(result.metadata.assetCount).toBe(0);
    expect(result.metadata.parseWarnings).toEqual([]);
  });

  it.each([
    "notes.txt",
    "data.csv",
    "config.json",
    "main.ts",
    "page.tsx",
    "script.js",
    "component.jsx",
    "model.py",
    "driver.c",
    "engine.cpp",
    "header.h",
    "App.java",
    "query.sql",
    "index.html",
    "styles.css",
  ])("can parse %s", (filename) => {
    const parser = new TextLocalParser();
    expect(parser.canParse(makeInput(filename, "application/octet-stream", Buffer.from("x")))).toBe(true);
  });

  it("does not parse binary or unsupported extensions", () => {
    const parser = new TextLocalParser();
    expect(parser.canParse(makeInput("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", Buffer.from("x")))).toBe(false);
    expect(parser.canParse(makeInput("report.pdf", "application/pdf", Buffer.from("x")))).toBe(false);
    expect(parser.canParse(makeInput("image", "image/png", Buffer.from("x")))).toBe(false);
  });
});
