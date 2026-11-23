import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocsMarkdown } from "./docs-markdown";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("DocsMarkdown", () => {
  it("replaces the smart UI demo fence with the real component", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    render(<DocsMarkdown content={"```smart-ui-demo\n交互示例：电压恒为 6 V。\n```"} />);
    await waitFor(() => {
      expect(screen.getByText("可交互示例 · 电路实验")).toBeTruthy();
    }, { timeout: 5000 });
    expect(screen.queryByText("交互示例：电压恒为 6 V。")).toBeNull();
  });
});
