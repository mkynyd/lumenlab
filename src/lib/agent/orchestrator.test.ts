import { describe, expect, it } from "vitest";
import {
  buildPlannedToolCalls,
  executePlannedToolCalls,
  getToolRoundLimit,
  shouldStopToolLoop,
  type ToolLoopRecord,
} from "./orchestrator";

describe("agent orchestrator loop controls", () => {
  it("executes planned tools, aggregates sources, and builds a context message", async () => {
    const calls = [
      {
        id: "planned-web-fetch-1",
        name: "web.fetch" as const,
        input: { url: "https://example.com/article" },
      },
      {
        id: "planned-project-rag-search-1",
        name: "project_rag.search" as const,
        input: { projectId: "project-1", query: "B+ 树", maxResults: 5 },
      },
    ];

    const result = await executePlannedToolCalls({
      profile: "research",
      plannedCalls: calls,
      runTool: async (call) => {
        if (call.name === "web.fetch") {
          return {
            status: "succeeded",
            summary: {
              url: "https://example.com/article",
              title: "Readable title",
              markdown: "Readable webpage body",
              status: 200,
            },
          };
        }
        return {
          status: "succeeded",
          summary: {
            hits: [
              {
                file: "第1章-绪论.pptx",
                fileId: "file-1",
                snippet: "B+ 树课程片段",
                score: 3,
              },
            ],
          },
        };
      },
    });

    expect(result.sources.map((source) => source.title)).toEqual([
      "Readable title",
      "第1章-绪论.pptx",
    ]);
    expect(result.contextMessage).toContain("web.fetch");
    expect(result.contextMessage).toContain("Readable webpage body");
    expect(result.contextMessage).toContain("B+ 树课程片段");
    expect(result.stopReason).toBeNull();
  });

  it("plans no tools for simple ordinary chat", () => {
    expect(
      buildPlannedToolCalls({
        prompt: "你好，解释一下这个概念",
        profile: "simple",
      })
    ).toEqual([]);
  });

  it("plans web.fetch for explicit public URLs", () => {
    expect(
      buildPlannedToolCalls({
        prompt: "请总结 https://example.com/article 这篇网页",
        profile: "research",
      })
    ).toEqual([
      {
        id: "planned-web-fetch-1",
        name: "web.fetch",
        input: { url: "https://example.com/article" },
      },
    ]);
  });

  it("plans selected project files before broad RAG search", () => {
    expect(
      buildPlannedToolCalls({
        prompt: "总结一下选中的章节资料",
        profile: "rag",
        projectId: "project-1",
        selectedFileIds: ["file-1", "file-2"],
      })
    ).toEqual([
      {
        id: "planned-project-file-read-1",
        name: "project_files.read",
        input: { projectId: "project-1", fileId: "file-1", maxChars: 12000 },
      },
      {
        id: "planned-project-file-read-2",
        name: "project_files.read",
        input: { projectId: "project-1", fileId: "file-2", maxChars: 12000 },
      },
    ]);
  });

  it("plans project RAG search when a project context task has no selected files", () => {
    expect(
      buildPlannedToolCalls({
        prompt: "根据项目资料解释 B+ 树",
        profile: "rag",
        projectId: "project-1",
      })
    ).toEqual([
      {
        id: "planned-project-rag-search-1",
        name: "project_rag.search",
        input: { projectId: "project-1", query: "根据项目资料解释 B+ 树", maxResults: 5 },
      },
    ]);
  });

  it("uses bounded tool budgets by task profile", () => {
    expect(getToolRoundLimit("simple")).toBe(2);
    expect(getToolRoundLimit("rag")).toBe(4);
    expect(getToolRoundLimit("research")).toBe(6);
    expect(getToolRoundLimit("workflow")).toBe(10);
  });

  it("stops when the profile round budget is reached", () => {
    expect(
      shouldStopToolLoop({
        profile: "rag",
        round: 4,
        history: [],
      })
    ).toEqual({ stop: true, reason: "round_limit" });
  });

  it("stops duplicate tool calls with identical normalized arguments", () => {
    const history: ToolLoopRecord[] = [
      { toolId: "web.fetch", args: { url: "https://example.com/a" }, producedNewContent: true },
      { toolId: "web.fetch", args: { url: "https://example.com/a" }, producedNewContent: true },
    ];

    expect(
      shouldStopToolLoop({
        profile: "research",
        round: 2,
        history,
      })
    ).toEqual({ stop: true, reason: "duplicate_tool_call" });
  });

  it("stops after two consecutive no-progress tool results", () => {
    const history: ToolLoopRecord[] = [
      { toolId: "project_rag.search", args: { query: "x" }, producedNewContent: false },
      { toolId: "web.fetch", args: { url: "https://example.com/x" }, producedNewContent: false },
    ];

    expect(
      shouldStopToolLoop({
        profile: "workflow",
        round: 2,
        history,
      })
    ).toEqual({ stop: true, reason: "no_progress" });
  });

  it("plans arxiv.read for arXiv IDs", () => {
    expect(
      buildPlannedToolCalls({
        prompt: "帮我读一下 arxiv:2401.00001",
        profile: "research",
      })
    ).toEqual([
      {
        id: "planned-arxiv-read-1",
        name: "arxiv.read",
        input: { arxivId: "2401.00001" },
      },
    ]);
  });

  it("plans web.search for explicit web search intent", () => {
    expect(
      buildPlannedToolCalls({
        prompt: "联网搜索最新的 deepseek 消息",
        profile: "research",
      })
    ).toEqual([
      {
        id: "planned-web-search-1",
        name: "web.search",
        input: { query: "联网搜索最新的 deepseek 消息", maxResults: 5 },
      },
    ]);
  });

  it("plans project_files.list for listing intent", () => {
    expect(
      buildPlannedToolCalls({
        prompt: "列出项目资料",
        profile: "rag",
        projectId: "project-1",
      })
    ).toEqual([
      {
        id: "planned-project-files-list-1",
        name: "project_files.list",
        input: { projectId: "project-1" },
      },
      {
        id: "planned-project-rag-search-1",
        name: "project_rag.search",
        input: { projectId: "project-1", query: "列出项目资料", maxResults: 5 },
      },
    ]);
  });
});
