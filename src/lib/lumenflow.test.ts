import { describe, expect, it } from "vitest";

import { parseLumenFlow, renderLumenFlowSvg } from "@/lib/lumenflow";

const validDiagram = JSON.stringify({
  version: 1,
  title: "实验闭环",
  nodes: [
    { id: "collect", label: "收集资料", tone: "default" },
    { id: "run", label: "运行 Agent", tone: "primary" },
    { id: "review", label: "审阅结果", tone: "default" },
  ],
  returnFlow: { label: "需要审批", text: "审批后继续执行" },
  edges: [
    ["collect", "run"],
    ["run", "review"],
  ],
});

describe("LumenFlow", () => {
  it("parses a compact, safe workflow definition", () => {
    const result = parseLumenFlow(validDiagram);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.diagram.title).toBe("实验闭环");
    expect(result.diagram.nodes).toHaveLength(3);
    expect(result.diagram.edges).toEqual([
      ["collect", "run"],
      ["run", "review"],
    ]);
    expect(result.diagram.returnFlow?.label).toBe("需要审批");
  });

  it("rejects oversized and disconnected diagrams", () => {
    const oversized = JSON.stringify({
      version: 1,
      nodes: Array.from({ length: 13 }, (_, index) => ({
        id: `node-${index}`,
        label: `节点 ${index}`,
      })),
      edges: [],
    });

    expect(parseLumenFlow(oversized)).toMatchObject({ ok: false });
    expect(
      parseLumenFlow(
        JSON.stringify({
          version: 1,
          nodes: [{ id: "a", label: "A" }],
          edges: [["a", "missing"]],
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLumenFlow(
        JSON.stringify({
          version: 1,
          nodes: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
            { id: "c", label: "C" },
          ],
          edges: [["a", "c"]],
        })
      ),
    ).toMatchObject({ ok: false });
  });

  it("produces a self-contained SVG for DOCX export", () => {
    const parsed = parseLumenFlow(validDiagram);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const svg = renderLumenFlowSvg(parsed.diagram);

    expect(svg).toContain("<svg");
    expect(svg).toContain("收集资料");
    expect(svg).toContain("marker-end");
  });
});
