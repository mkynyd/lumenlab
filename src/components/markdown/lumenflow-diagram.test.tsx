import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LumenFlowDiagram } from "./lumenflow-diagram";

function flow(labels: string[]) {
  return JSON.stringify({
    version: 1,
    title: "状态迁转",
    nodes: labels.map((label, index) => ({ id: `n${index}`, label })),
    edges: labels.slice(1).map((_, index) => [`n${index}`, `n${index + 1}`]),
  });
}

describe("LumenFlowDiagram", () => {
  it("renders a valid compact flow", () => {
    render(<LumenFlowDiagram code={flow(["收集资料", "运行 Agent", "审阅结果"])} />);
    expect(screen.getByText("状态迁转")).toBeTruthy();
    for (const label of ["收集资料", "运行 Agent", "审阅结果"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("keeps an overlong but otherwise valid flow readable instead of failing the whole block", () => {
    const long = "客户端发出 SYN 后进入 SYN_SENT，等待服务端回 SYN+ACK，再发送确认";
    render(<LumenFlowDiagram code={flow([long, "服务端回 SYN+ACK 后进入 SYN_RCVD", "双方进入 ESTABLISHED"])} />);
    expect(screen.getByText(long)).toBeTruthy();
    expect(screen.getByText(/图表文字超出长度限制/)).toBeTruthy();
    expect(screen.queryByText(/LumenFlow 格式无效/)).toBeNull();
  });

  it("shows the raw block when the structure cannot be salvaged", () => {
    render(<LumenFlowDiagram code="{not-json" />);
    expect(screen.getByText(/LumenFlow 格式无效/)).toBeTruthy();
    expect(screen.getByText("{not-json")).toBeTruthy();
  });
});
