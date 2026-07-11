import { describe, expect, it } from "vitest";
import {
  extractMermaidNodeLabels,
  ensureNodeLabels,
} from "./ensure-node-labels";

describe("extractMermaidNodeLabels", () => {
  it("extracts labels from various node shapes", () => {
    const code = `flowchart LR
      A[你的任务] --> B{复杂度？}
      B --> C(Sol / Sol Ultra)
      C --> D((Terra))
      D --> E(((Luna)))
      E --> F[[卡片]]
      F --> G[(圆柱)]
      G --> H{{六边形}}
      H --> I>旗形]
    `;
    const labels = extractMermaidNodeLabels(code);
    expect(Object.fromEntries(labels)).toEqual({
      A: "你的任务",
      B: "复杂度？",
      C: "Sol / Sol Ultra",
      D: "Terra",
      E: "Luna",
      F: "卡片",
      G: "圆柱",
      H: "六边形",
      I: "旗形",
    });
  });

  it("skips classDef, class, style, linkStyle and init directives", () => {
    const code = `flowchart LR
      classDef sol fill:#fff5f5,stroke:#e53e3e,color:#000
      class C sol
      style A fill:#fff
      linkStyle 0 stroke:#000
      init {"flowchart": {"htmlLabels": false}}
      A[你的任务] --> B{复杂度？}
    `;
    const labels = extractMermaidNodeLabels(code);
    expect(Object.fromEntries(labels)).toEqual({
      A: "你的任务",
      B: "复杂度？",
    });
  });

  it("skips labels that equal the node id", () => {
    const code = `flowchart LR
      A[A] --> B[有效标签]
    `;
    const labels = extractMermaidNodeLabels(code);
    expect(Object.fromEntries(labels)).toEqual({
      B: "有效标签",
    });
  });

  it("handles labels in arrow statements", () => {
    const code = `flowchart LR
      subgraph S1 [分组]
        direction LR
        A[输入] --> B[处理] --> C[输出]
      end
    `;
    const labels = extractMermaidNodeLabels(code);
    expect(Object.fromEntries(labels)).toEqual({
      S1: "分组",
      A: "输入",
      B: "处理",
      C: "输出",
    });
  });
});

describe("ensureNodeLabels", () => {
  it("fills empty node labels from mermaid source code", () => {
    const code = `flowchart LR
      A[你的任务] --> B{复杂度？}
      B -->|前沿研究| C[Sol / Sol Ultra]
      classDef sol fill:#fff5f5,stroke:#e53e3e,color:#000
      class C sol
    `;

    // Simulated SVG with empty node label text elements (Mermaid v11 + classDef behavior).
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g class="nodes">
        <g id="flowchart-A-0" class="node default">
          <rect class="label-container"></rect>
          <g class="label">
            <rect></rect>
          </g>
        </g>
        <g id="flowchart-B-1" class="node default">
          <polygon class="label-container"></polygon>
          <g class="label">
            <rect></rect>
            <text text-anchor="middle" y="-10.1">
              <tspan class="text-outer-tspan row"></tspan>
            </text>
          </g>
        </g>
        <g id="flowchart-C-3" class="node default sol">
          <rect class="label-container"></rect>
          <g class="label">
            <rect></rect>
          </g>
        </g>
      </g>
    </svg>`;

    const result = ensureNodeLabels(svg, code);
    expect(result).toContain("你的任务");
    expect(result).toContain("复杂度？");
    expect(result).toContain("Sol / Sol Ultra");
  });

  it("leaves non-empty labels unchanged", () => {
    const code = `flowchart LR\nA[你的任务]`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g class="nodes">
        <g id="flowchart-A-0" class="node default">
          <g class="label">
            <text><tspan>已有内容</tspan></text>
          </g>
        </g>
      </g>
    </svg>`;
    const result = ensureNodeLabels(svg, code);
    expect(result).toContain("已有内容");
    expect(result).not.toContain("你的任务");
  });
});
