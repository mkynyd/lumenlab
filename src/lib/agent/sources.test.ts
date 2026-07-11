import { describe, expect, it } from "vitest";
import {
  aggregateSources,
  extractSourcesFromToolResult,
  type AgentSource,
} from "./sources";

describe("agent sources", () => {
  it("deduplicates sources by stable key while preserving first-use order", () => {
    const sources: AgentSource[] = [
      { type: "web", title: "A", url: "https://example.com/a", usedAt: 2 },
      { type: "project_file", title: "Lecture 1", fileId: "file-1", usedAt: 3 },
      { type: "web", title: "A duplicate", url: "https://example.com/a#section", usedAt: 4 },
      { type: "artifact", title: "Saved Notes", artifactId: "art-1", usedAt: 5 },
    ];

    expect(aggregateSources(sources)).toEqual([
      { type: "web", title: "A", url: "https://example.com/a", usedAt: 2 },
      { type: "project_file", title: "Lecture 1", fileId: "file-1", usedAt: 3 },
      { type: "artifact", title: "Saved Notes", artifactId: "art-1", usedAt: 5 },
    ]);
  });

  it("builds project file sources from RAG hits", () => {
    const sources = extractSourcesFromToolResult("project_rag.search", {
      hits: [
        {
          file: "第1章-绪论.pptx",
          fileId: "file-1",
          snippet: "课程绪论片段",
          score: 3,
        },
        {
          file: "第2章-索引结构.pdf",
          fileId: "file-2",
          snippet: "B+树片段",
          score: 2,
        },
      ],
    });

    expect(sources).toEqual([
      {
        type: "project_file",
        title: "第1章-绪论.pptx",
        fileId: "file-1",
        snippet: "课程绪论片段",
        metadata: { score: 3 },
      },
      {
        type: "project_file",
        title: "第2章-索引结构.pdf",
        fileId: "file-2",
        snippet: "B+树片段",
        metadata: { score: 2 },
      },
    ]);
  });

  it("builds web sources from web.fetch results", () => {
    expect(
      extractSourcesFromToolResult("web.fetch", {
        url: "https://example.com/post",
        title: "Readable title",
        status: 200,
      })
    ).toEqual([
      {
        type: "web",
        title: "Readable title",
        url: "https://example.com/post",
        metadata: { status: 200 },
      },
    ]);
  });

  it("builds persistent web sources from web.search results", () => {
    expect(
      extractSourcesFromToolResult("web.search", {
        query: "hidden query context",
        sources: [
          { url: "https://example.com/post", title: "Verified result" },
        ],
      })
    ).toEqual([
      {
        type: "web",
        title: "Verified result",
        url: "https://example.com/post",
      },
    ]);
  });
});
