import { describe, expect, it } from "vitest";
import { mapSyncTexToNodes, parseSyncTexText } from "./synctex";

const SAMPLE = [
  "SyncTeX Version:1",
  "Input:1:/compile-workspace/main.tex",
  "Input:2:/compile-workspace/generated-content.tex",
  "Content:",
  "!1",
  "{1",
  "k2,4:65536,131072,32768,8192,0",
  "}",
  "!2",
  "[2,9:131072,196608,65536,8192,0]",
  "Postamble:",
].join("\n");

describe("SyncTeX mapping", () => {
  it("parses page, source tag, line and scaled coordinates", () => {
    expect(parseSyncTexText(SAMPLE)).toEqual([
      { page: 1, tag: 2, line: 4, sourceFile: "generated-content.tex", x: 1, y: 2, width: 0.5, height: 0.125 },
      { page: 2, tag: 2, line: 9, sourceFile: "generated-content.tex", x: 2, y: 3, width: 1, height: 0.125 },
    ]);
  });

  it("maps rendered document nodes to the closest generated-content line", () => {
    const result = mapSyncTexToNodes({ text: SAMPLE, nodeMap: { "section-1": { line: 4, kind: "heading" }, "paragraph-1": { line: 8, kind: "paragraph" } } });
    expect(result.pageCount).toBe(2);
    expect(result.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "section-1", page: 1, line: 4 }),
      expect.objectContaining({ nodeId: "paragraph-1", page: 2, line: 9 }),
    ]));
  });
});
