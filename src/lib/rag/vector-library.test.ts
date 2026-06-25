import { describe, expect, it } from "vitest";
import { buildVectorLibraryGraph } from "./vector-library";
import type { ProjectFile, VectorLibraryNode } from "@/lib/api/types";

describe("buildVectorLibraryGraph", () => {
  const files: ProjectFile[] = [
    {
      id: "f1",
      filename: "a.md",
      originalName: "电路基础.md",
      mimeType: "text/markdown",
      size: 100,
      status: "parsed",
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "f2",
      filename: "b.md",
      originalName: "模拟电路.md",
      mimeType: "text/markdown",
      size: 100,
      status: "parsed",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ];

  const chunks = {
    f1: [
      { id: "c1", content: "电阻和电容组成电路", chunkIndex: 0, tokenCount: 10 },
      { id: "c2", content: "基尔霍夫电压定律", chunkIndex: 1, tokenCount: 8 },
    ],
    f2: [
      { id: "c3", content: "二极管与电容滤波电路", chunkIndex: 0, tokenCount: 9 },
    ],
  };

  it("returns topic nodes shared across files", () => {
    const graph = buildVectorLibraryGraph(files, chunks);
    const topicLabels = graph.nodes
      .filter((n): n is VectorLibraryNode & { type: "topic" } => n.type === "topic")
      .map((n) => n.label);
    expect(topicLabels).toContain("电路");
    expect(topicLabels).toContain("电容");
    expect(graph.stats.fileCount).toBe(2);
    expect(graph.stats.chunkCount).toBe(3);
  });

  it("links chunks to their parent file", () => {
    const graph = buildVectorLibraryGraph(files, chunks);
    const chunkLinks = graph.links.filter(
      (l) =>
        (l.source as string) === "f1" && (l.target as string).startsWith("c")
    );
    expect(chunkLinks.length).toBe(2);
  });

  it("marks failed files and preserves processing error", () => {
    const failed: ProjectFile[] = [
      {
        ...files[0],
        status: "failed",
        processingError: "OCR 超时",
      },
    ];
    const graph = buildVectorLibraryGraph(failed, { f1: [] });
    const fileNode = graph.nodes.find((n) => n.type === "file");
    expect(fileNode?.status).toBe("failed");
    expect(fileNode?.processingError).toBe("OCR 超时");
  });
});
