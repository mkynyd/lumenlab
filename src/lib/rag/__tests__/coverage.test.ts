import { beforeEach, describe, expect, it, vi } from "vitest";

import { classifyCoverage, containsQueryTerms } from "../coverage";
import { searchChunksByKeyword } from "../vector-store";

vi.mock("../vector-store", () => ({
  searchChunksByKeyword: vi.fn(),
}));

const mockedKeywordSearch = vi.mocked(searchChunksByKeyword);

describe("containsQueryTerms", () => {
  it("matches han and latin terms of the query", () => {
    expect(containsQueryTerms("基尔霍夫电流定律是核心。", "基尔霍夫电流")).toBe(
      true
    );
    expect(containsQueryTerms("节点电压法。", "基尔霍夫电流")).toBe(false);
    expect(containsQueryTerms("Kirchhoff's law applies.", "kirchhoff")).toBe(
      true
    );
    expect(containsQueryTerms("无相关内容。", "nothing")).toBe(false);
  });

  it("falls back to substring matching when the query has no terms", () => {
    expect(containsQueryTerms("ab", "ab")).toBe(true);
    expect(containsQueryTerms("xyz", "ab")).toBe(false);
  });
});

describe("classifyCoverage", () => {
  beforeEach(() => {
    mockedKeywordSearch.mockReset();
  });

  it("classifies covered when a retrieved result mentions the query", async () => {
    const verdict = await classifyCoverage({
      userId: "u1",
      projectId: "p1",
      query: "基尔霍夫电流定律",
      retrievalResults: [
        { fileAssetId: "f1", content: "基尔霍夫电流定律：节点电流代数和为零。" },
      ],
    });
    expect(verdict).toBe("covered");
    expect(mockedKeywordSearch).not.toHaveBeenCalled();
  });

  it("classifies retrieval_miss when only the fallback scan finds the topic", async () => {
    mockedKeywordSearch.mockResolvedValue([
      {
        id: "c1",
        content: "基尔霍夫电流定律是电路分析的基础。",
        title: "电路原理.md",
        fileAssetId: "f1",
        projectId: "p1",
        chunkIndex: 0,
        originalName: "电路原理.md",
      },
    ]);
    const verdict = await classifyCoverage({
      userId: "u1",
      projectId: "p1",
      query: "基尔霍夫电流定律",
      retrievalResults: [
        { fileAssetId: "f1", content: "第一章 直流电路。" },
      ],
    });
    expect(verdict).toBe("retrieval_miss");
    expect(mockedKeywordSearch).toHaveBeenCalledWith({
      userId: "u1",
      projectId: "p1",
      query: "基尔霍夫电流定律",
      limit: 5,
    });
  });

  it("classifies material_absent when nothing matches anywhere", async () => {
    mockedKeywordSearch.mockResolvedValue([
      {
        id: "c1",
        content: "节点电压法。",
        title: "电路原理.md",
        fileAssetId: "f1",
        projectId: "p1",
        chunkIndex: 0,
        originalName: "电路原理.md",
      },
    ]);
    const verdict = await classifyCoverage({
      userId: "u1",
      projectId: "p1",
      query: "傅里叶变换",
      retrievalResults: [
        { fileAssetId: "f1", content: "节点电压法。" },
      ],
    });
    expect(verdict).toBe("material_absent");
  });
});
