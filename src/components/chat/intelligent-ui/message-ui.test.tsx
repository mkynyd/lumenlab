import { act, render, screen } from "@testing-library/react";
import { memo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UISurface } from "@/lib/chat/intelligent-ui/catalog";
import { getLoadedSurface, loadSurface } from "./loaders";
import { MessageUI } from "./message-ui";

vi.mock("./loaders", () => ({ getLoadedSurface: vi.fn(), loadSurface: vi.fn(), loadChart: vi.fn() }));

const surface: UISurface = {
  schemaVersion: 1,
  catalogVersion: 1,
  surfaceId: "example",
  groups: [{ id: "intro", nodes: [{ id: "label", type: "text", props: { text: "已准备就绪" } }] }],
};

const TestSurface = memo(function TestSurface() {
  return <button type="button">设置范围</button>;
});

describe("MessageUI", () => {
  beforeEach(() => vi.resetAllMocks());

  it("loads the renderer only for an existing surface and reveals it when the module resolves", async () => {
    let resolveModule!: (module: Awaited<ReturnType<typeof loadSurface>>) => void;
    vi.mocked(loadSurface).mockReturnValue(new Promise((resolve) => { resolveModule = resolve; }));
    const { rerender } = render(<MessageUI id="message" />);
    expect(loadSurface).not.toHaveBeenCalled();

    rerender(<MessageUI id="message" saved={surface} />);
    expect(screen.getByRole("status").textContent).toBe("正在加载交互内容…");
    await act(async () => {
      resolveModule({ default: TestSurface });
    });
    expect(screen.getByRole("button", { name: "设置范围" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders an arriving surface immediately when preloading already completed", () => {
    const { rerender } = render(<MessageUI id="message" />);
    vi.mocked(getLoadedSurface).mockReturnValue(TestSurface);

    rerender(<MessageUI id="message" saved={surface} />);

    expect(screen.getByRole("button", { name: "设置范围" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(loadSurface).not.toHaveBeenCalled();
  });
});
