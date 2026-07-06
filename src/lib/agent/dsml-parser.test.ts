import { describe, expect, it } from "vitest";
import { extractDsmlToolCalls, stripDsmlToolCalls } from "./dsml-parser";

const SAMPLE = `<| | DSML | | tool_calls> <| | DSML | | invoke name="web_search"> <| | DSML | | parameter name="query" string="true">网络信息安全风险评估 属于 设计阶段 还是 规划阶段 生命周期</| | DSML | | parameter> </| | DSML | | invoke> </| | DSML | | tool_calls>`;

describe("dsml-parser", () => {
  describe("extractDsmlToolCalls", () => {
    it("returns empty array for plain text", () => {
      expect(extractDsmlToolCalls("no markup here")).toEqual([]);
      expect(extractDsmlToolCalls("")).toEqual([]);
    });

    it("extracts a web_search call from observed DSML", () => {
      const calls = extractDsmlToolCalls(SAMPLE);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        name: "web_search",
        input: {
          query: "网络信息安全风险评估 属于 设计阶段 还是 规划阶段 生命周期",
        },
      });
    });

    it("extracts multiple parameters", () => {
      const text = `<| | DSML | | tool_calls>
        <| | DSML | | invoke name="web.search">
          <| | DSML | | parameter name="query" string="true">foo</| | DSML | | parameter>
          <| | DSML | | parameter name="maxResults" string="true">3</| | DSML | | parameter>
        </| | DSML | | invoke>
      </| | DSML | | tool_calls>`;
      const calls = extractDsmlToolCalls(text);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        name: "web.search",
        input: { query: "foo", maxResults: "3" },
      });
    });
  });

  describe("stripDsmlToolCalls", () => {
    it("returns plain text unchanged", () => {
      expect(stripDsmlToolCalls("plain text")).toBe("plain text");
    });

    it("removes DSML tool_calls block", () => {
      const cleaned = stripDsmlToolCalls(`先思考一下。\n${SAMPLE}\n然后回答。`);
      expect(cleaned).not.toContain("DSML");
      expect(cleaned).not.toContain("tool_calls");
      expect(cleaned).toContain("先思考一下。");
      expect(cleaned).toContain("然后回答。");
    });

    it("trims extra blank lines", () => {
      const cleaned = stripDsmlToolCalls(`line1\n\n\n${SAMPLE}\n\n\nline2`);
      expect(cleaned).toBe("line1\n\nline2");
    });
  });
});
