import { beforeAll, describe, expect, it } from "vitest";
import {
  parseToolCalls,
  sanitizeModelText,
} from "@/lib/agent/tool-call-parser";
import { ensureDiscovery } from "@/lib/skills/registry";
import "@/lib/tools/registry";

beforeAll(async () => {
  await ensureDiscovery();
});

describe("sanitizeModelText", () => {
  it("removes complete XML tool_calls blocks", () => {
    const text =
      '计划如下。\n<tool_calls>\n<invoke name="project_files.list">\n<parameter name="projectId">p1</parameter>\n</invoke>\n</tool_calls>\n开始写作。';
    const cleaned = sanitizeModelText(text);
    expect(cleaned).toContain("计划如下。");
    expect(cleaned).toContain("开始写作。");
    expect(cleaned).not.toContain("<tool_calls>");
    expect(cleaned).not.toContain("invoke name");
    expect(cleaned).not.toContain("projectId");
  });

  it("removes malformed and truncated tool markup", () => {
    const text = '思考：<tool_calls> <tool_calls> list </tool_calls> 继续。';
    const cleaned = sanitizeModelText(text);
    expect(cleaned).toContain("思考：");
    expect(cleaned).toContain("继续。");
    expect(cleaned).not.toContain("<tool_calls>");
    expect(cleaned).not.toContain("list");
  });

  it("removes DSML markers", () => {
    const text =
      '先检索。\n<| | DSML | | tool_calls>\n<| | DSML | | invoke name="web.search">\n<| | DSML | | parameter name="query">test</| | DSML | | parameter>\n</| | DSML | | invoke>\n</| | DSML | | tool_calls>\n回答。';
    const cleaned = sanitizeModelText(text);
    expect(cleaned).toContain("先检索。");
    expect(cleaned).toContain("回答。");
    expect(cleaned).not.toContain("DSML");
    expect(cleaned).not.toContain("<|");
  });

  it("removes bare invoke/parameter tags", () => {
    const text = '内容<invoke name="x"><parameter name="y">z</parameter></invoke>结尾';
    const cleaned = sanitizeModelText(text);
    expect(cleaned).toBe("内容结尾");
  });
});

describe("parseToolCalls", () => {
  it("parses a valid XML invoke", () => {
    const text =
      '<tool_calls>\n<invoke name="project_files.list">\n<parameter name="projectId">p1</parameter>\n</invoke>\n</tool_calls>';
    const calls = parseToolCalls(text);
    expect(calls).toEqual([
      { name: "project_files.list", input: { projectId: "p1" } },
    ]);
  });

  it("parses a valid DSML invoke", () => {
    const text =
      '<| | DSML | | invoke name="project_rag.search">\n<| | DSML | | parameter name="query">等级保护</| | DSML | | parameter>\n</| | DSML | | invoke>';
    const calls = parseToolCalls(text);
    expect(calls).toEqual([
      { name: "project_rag.search", input: { query: "等级保护" } },
    ]);
  });

  it("parses a native tool_use idiom already extracted elsewhere", () => {
    // parseToolCalls is only for markup; native blocks are handled by the SDK.
    const text = 'no markup';
    expect(parseToolCalls(text)).toEqual([]);
  });

  it("rejects truncated tool_calls blocks", () => {
    const text = '内容<tool_calls><invoke name="project_files.list">';
    expect(parseToolCalls(text)).toEqual([]);
  });

  it("rejects nested tool_calls", () => {
    const text =
      '<tool_calls><tool_calls> list </tool_calls></tool_calls>';
    expect(parseToolCalls(text)).toEqual([]);
  });

  it("rejects an invoke without a name", () => {
    const text =
      '<tool_calls><invoke><parameter name="projectId">p1</parameter></invoke></tool_calls>';
    expect(parseToolCalls(text)).toEqual([]);
  });

  it("rejects unknown hallucinated tool names like foo.bar", () => {
    const text =
      '<tool_calls><invoke name="foo.bar"><parameter name="x">1</parameter></invoke></tool_calls>';
    expect(parseToolCalls(text)).toEqual([]);
  });

  it("rejects system.list and artifact.delete as unknown tools", () => {
    const text =
      '<tool_calls><invoke name="system.list"><parameter name="x">1</parameter></invoke></tool_calls>';
    expect(parseToolCalls(text)).toEqual([]);
  });

  it("resolves skill aliases to registered tools", () => {
    const text =
      '<tool_calls><invoke name="list_files"><parameter name="projectId">p1</parameter></invoke></tool_calls>';
    const calls = parseToolCalls(text);
    expect(calls).toEqual([
      { name: "project_files.list", input: { projectId: "p1" } },
    ]);
  });

  it("resolves known skill ids to skill.activate", () => {
    const text =
      '<tool_calls><invoke name="paper-writer"><parameter name="topic">x</parameter></invoke></tool_calls>';
    const calls = parseToolCalls(text);
    expect(calls).toEqual([
      { name: "skill.activate", input: { name: "paper-writer", topic: "x" } },
    ]);
  });

  it("deduplicates XML and DSML representations of the same call", () => {
    const text =
      '<tool_calls><invoke name="project_files.list"><parameter name="projectId">p1</parameter></invoke></tool_calls>\n' +
      '<| | DSML | | invoke name="project_files.list"><| | DSML | | parameter name="projectId">p1</| | DSML | | parameter></| | DSML | | invoke>';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      name: "project_files.list",
      input: { projectId: "p1" },
    });
  });
});
