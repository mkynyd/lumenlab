import { describe, expect, it } from "vitest";
import { mapCompileErrorToNode } from "./compile-errors";

describe("paper compile error mapping", () => {
  const nodeMap = {
    "heading-1": { line: 12, generatedLine: 1, kind: "heading" },
    "equation-1": { line: 19, generatedLine: 8, kind: "equation" },
  };

  it("maps generated-content errors to the nearest Document node", () => {
    expect(mapCompileErrorToNode({ output: "! LaTeX Error: Missing $ inserted.\ngenerated-content.tex:9: error", nodeMap })).toEqual({ nodeId: "equation-1", line: 8, kind: "equation", source: "generated" });
  });

  it("maps main.tex errors and returns null when no source line exists", () => {
    expect(mapCompileErrorToNode({ output: "main.tex:13: Undefined control sequence", nodeMap })).toMatchObject({ nodeId: "heading-1", source: "main" });
    expect(mapCompileErrorToNode({ output: "fatal compiler error", nodeMap })).toBeNull();
  });
});
