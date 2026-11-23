import { act, render, screen } from "@testing-library/react";
import { memo } from "react";
import { describe, expect, it, vi } from "vitest";
import type { UISurface } from "@/lib/chat/intelligent-ui/catalog";
import { loadSurface } from "./loaders";
import { MessageUI } from "./message-ui";

vi.mock("./loaders", () => ({ loadSurface: vi.fn(), loadChart: vi.fn() }));

describe("MessageUI", () => {
  it("loads the renderer only for an existing surface and reveals it when the module resolves", async () => {
    const surface: UISurface = {
      schemaVersion: 1,
      catalogVersion: 1,
      surfaceId: "example",
      groups: [{ id: "intro", nodes: [{ id: "label", type: "text", props: { text: "已准备就绪" } }] }],
    };
    let resolveModule!: (module: Awaited<ReturnType<typeof loadSurface>>) => void;
    vi.mocked(loadSurface).mockReturnValue(new Promise((resolve) => { resolveModule = resolve; }));
    const { rerender } = render(<MessageUI id="message" />);
    expect(loadSurface).not.toHaveBeenCalled();

    rerender(<MessageUI id="message" saved={surface} />);
    expect(screen.getByRole("status").textContent).toBe("正在加载交互内容…");
    await act(async () => {
      resolveModule({ default: memo(function TestSurface() {
        return <button type="button">设置范围</button>;
      }) });
    });
    expect(screen.getByRole("button", { name: "设置范围" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
