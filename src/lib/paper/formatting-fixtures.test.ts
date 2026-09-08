// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FORMATTING_FIXTURE_METADATA, FORMATTING_MARKDOWN_FIXTURE, buildFormattingDocxFixture } from "./formatting-fixtures";
import { parseFormattingSource } from "./formatting-import";

const kinds = (blocks: Array<{ kind: string }>) => blocks.map((block) => block.kind);

describe("formatting fixtures", () => {
  it("imports the DOCX fixture with headings, figure, table, equation and footnote", async () => {
    const parsed = await parseFormattingSource({ filename: "fixture.docx", buffer: await buildFormattingDocxFixture(), metadata: FORMATTING_FIXTURE_METADATA, signal: new AbortController().signal });
    const blocks = kinds(parsed.document.blocks);
    expect(blocks[0]).toBe("paper_metadata");
    expect(blocks.filter((kind) => kind === "heading").length).toBeGreaterThanOrEqual(3);
    expect(blocks).toContain("figure");
    expect(blocks).toContain("table");
    expect(blocks).toContain("equation");
    expect(parsed.assets).toHaveLength(1);
    expect(JSON.stringify(parsed.document.blocks)).toContain("footnote");
  });

  it("imports the Markdown fixture with math, table, footnote and page break", async () => {
    const parsed = await parseFormattingSource({ filename: "fixture.md", buffer: Buffer.from(FORMATTING_MARKDOWN_FIXTURE, "utf8"), metadata: FORMATTING_FIXTURE_METADATA, signal: new AbortController().signal });
    const blocks = kinds(parsed.document.blocks);
    expect(blocks).toContain("equation");
    expect(blocks).toContain("table");
    expect(blocks).toContain("quote");
    expect(blocks).toContain("list");
    expect(blocks).toContain("page_break");
    expect(JSON.stringify(parsed.document.blocks)).toContain("footnote");
    expect(JSON.stringify(parsed.document.blocks)).toContain("inline_math");
  });
});
