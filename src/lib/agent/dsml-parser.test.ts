import { describe, expect, it, beforeAll } from "vitest";
import { extractDsmlToolCalls, stripDsmlToolCalls } from "./dsml-parser";

// 触发工具注册
import "@/lib/tools/registry";
import { registerFromDiscovery } from "@/lib/skills/registry";

const SAMPLE = `<| | DSML | | tool_calls> <| | DSML | | invoke name="web_search"> <| | DSML | | parameter name="query" string="true">网络信息安全风险评估 属于 设计阶段 还是 规划阶段 生命周期</| | DSML | | parameter> </| | DSML | | invoke> </| | DSML | | tool_calls>`;

describe("dsml-parser", () => {
  beforeAll(async () => {
    await registerFromDiscovery();
  });

  describe("extractDsmlToolCalls", () => {
    it("returns empty array for plain text", () => {
      expect(extractDsmlToolCalls("no markup here")).toEqual([]);
      expect(extractDsmlToolCalls("")).toEqual([]);
    });

    it("extracts a web_search call from observed DSML", () => {
      const calls = extractDsmlToolCalls(SAMPLE);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        name: "web.search",
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

    it("extracts XML-style tool calls leaked in assistant content", () => {
      const text = `<tool_calls>
        <invoke name="project_files.list">
          <parameter name="projectId">project-1</parameter>
        </invoke>
      </tool_calls>`;

      expect(extractDsmlToolCalls(text)).toEqual([
        {
          name: "project_files.list",
          input: { projectId: "project-1" },
        },
      ]);
    });

    it("maps bare skill ids to skill activation", () => {
      expect(extractDsmlToolCalls("<tool_calls> paper-writer </tool_calls>")).toEqual([
        {
          name: "skill.activate",
          input: { name: "paper-writer" },
        },
      ]);
    });

    it("drops bare names that are neither a tool nor a skill", () => {
      expect(extractDsmlToolCalls("<tool_calls> project_files </tool_calls>")).toEqual([]);
      expect(extractDsmlToolCalls("<tool_calls> unknown_tool </tool_calls>")).toEqual([]);
    });

    it("maps common hallucinated tool names to registered tools", () => {
      expect(extractDsmlToolCalls("<tool_calls> list_files </tool_calls>")).toEqual([
        { name: "project_files.list", input: {} },
      ]);
      expect(extractDsmlToolCalls('<tool_calls><invoke name="read_file"><parameter name="fileId">f1</parameter></invoke></tool_calls>')).toEqual([
        { name: "project_files.read", input: { fileId: "f1" } },
      ]);
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

    it("removes XML-style tool_calls block", () => {
      const cleaned = stripDsmlToolCalls(
        "先检查资料。\n<tool_calls> project_files </tool_calls>\n然后回答。"
      );
      expect(cleaned).toBe("先检查资料。\n\n然后回答。");
    });

    it("trims extra blank lines", () => {
      const cleaned = stripDsmlToolCalls(`line1\n\n\n${SAMPLE}\n\n\nline2`);
      expect(cleaned).toBe("line1\n\nline2");
    });
  });
});
