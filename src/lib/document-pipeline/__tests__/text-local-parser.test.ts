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
  it("parses a .md file into structured Markdown blocks", async () => {
    const parser = new TextLocalParser();
    const input = makeInput("notes.md", "text/markdown", Buffer.from("# Hello\n\nWorld with **bold**"));

    expect(parser.canParse(input)).toBe(true);

    const result = await parser.parse(input);

    expect(result.blocks.map((b) => b.type)).toEqual(["heading", "text"]);
    const heading = result.blocks[0] as Extract<typeof result.blocks[number], { type: "heading" }>;
    expect(heading.content).toBe("Hello");
    expect(heading.preserveMarkdown).toBe(true);
    const text = result.blocks[1] as Extract<typeof result.blocks[number], { type: "text" }>;
    expect(text.content).toBe("World with **bold**");
    expect(text.preserveMarkdown).toBe(true);
    expect(result.assets).toHaveLength(0);
    expect(result.metadata.parser).toBe("text-local");
    expect(result.metadata.sourceKind).toBe("text");
    expect(result.metadata.pipelineVersion).toBe("0.3.1");
    expect(result.metadata.assetCount).toBe(0);
    expect(result.metadata.parseWarnings).toEqual([]);
  });

  it("keeps .md image references as plain text lines (no parse assets)", async () => {
    const parser = new TextLocalParser();
    const input = makeInput("notes.md", "text/markdown", Buffer.from("See ![chart](pics/chart.png)\n\nText."));

    const result = await parser.parse(input);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("text");
    const imageText = result.blocks[0] as Extract<typeof result.blocks[number], { type: "text" }>;
    expect(imageText.content).toContain("![chart](pics/chart.png)");
  });

  it("parses source code files into a code block", async () => {
    const parser = new TextLocalParser();
    const input = makeInput("main.ts", "application/octet-stream", Buffer.from("const x: number = 1;"));

    const result = await parser.parse(input);

    expect(result.blocks).toHaveLength(1);
    const code = result.blocks[0] as Extract<typeof result.blocks[number], { type: "code" }>;
    expect(code.type).toBe("code");
    expect(code.language).toBe("ts");
    expect(code.content).toBe("const x: number = 1;");
  });

  it("parses a .txt file into a single escaped text block", async () => {
    const parser = new TextLocalParser();
    const input = makeInput("notes.txt", "text/plain", Buffer.from("# not a heading"));

    const result = await parser.parse(input);

    expect(result.blocks).toHaveLength(1);
    const text = result.blocks[0] as Extract<typeof result.blocks[number], { type: "text" }>;
    expect(text.type).toBe("text");
    expect(text.preserveMarkdown).toBeUndefined();
    expect(text.content).toBe("# not a heading");
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
