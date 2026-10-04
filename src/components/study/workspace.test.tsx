import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionInput } from "@/lib/study/contracts";

const created = {
  id: "created",
  name: "数学二新题集",
  subject: "数学",
  exam: "考研",
  notebooks: [{ id: "book", name: "极限与连续" }],
};
vi.mock("@/components/blocks/onboarding-2", () => ({
  default: ({
    onCreate,
  }: {
    onCreate: (input: CollectionInput) => Promise<void>;
  }) => (
    <button
      onClick={() =>
        void onCreate({
          name: "数学二新题集",
          subject: "数学",
          stage: "university",
          grade: "",
          major: "",
          exam: "考研",
          syllabus: "",
          notebookName: "极限与连续",
        })
      }
    >
      确认创建题集
    </button>
  ),
}));
vi.mock("./assistant", () => ({ StudyAssistant: () => null }));
vi.mock("@/components/markdown/markdown-content", () => ({
  MarkdownContent: ({ content }: { content: string }) => <p>{content}</p>,
}));
import { StudyWorkspace } from "./workspace";
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("study library refresh", () => {
  it("refreshes item failure status when a processing job fails", async () => {
    vi.useFakeTimers();
    let failed = false;
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/api/study/collections") return json({ collections: [created] });
      if (path.endsWith("/jobs")) return json({ jobs: [{ id: "job", status: "processing", progress: 3, stage: "正在解析", attempts: 1 }] });
      if (path.endsWith("/jobs/job")) { failed = true; return json({ job: { id: "job", status: "failed", progress: 3, stage: "处理失败", attempts: 1 } }); }
      if (path.endsWith("/items")) return json({ items: [{ id: "item", prompt: "计算1+1", topics: [], status: failed ? "failed" : "processing" }] });
      if (path.endsWith("/tasks")) return json({ tasks: [] });
      return json({ events: [] });
    }));
    await act(async () => { render(<StudyWorkspace />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /极限与连续/ })); });
    expect(screen.getByRole("button", { name: /错题 1/ })).toHaveTextContent("处理中");
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(screen.getByRole("button", { name: /错题 1/ })).toHaveTextContent("处理失败");
    expect(screen.getByRole("button", { name: "重试处理" })).toBeVisible();
  });
  it("publishes a created card immediately and prevents an older GET from erasing it", async () => {
    let resolveOld!: (response: Response) => void;
    const old = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const fetcher = vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/study/collections")
        return init?.method === "POST"
          ? json({ collection: created }, 201)
          : old;
      if (path.endsWith("/jobs")) return json({ jobs: [] });
      if (path.endsWith("/tasks")) return json({ tasks: [] });
      return json({ events: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<StudyWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "新建题集" }));
    fireEvent.click(screen.getByRole("button", { name: "确认创建题集" }));
    expect(
      await screen.findByRole("article", { name: "题集：数学二新题集" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /极限与连续/ })).toBeVisible();
    await act(async () => {
      resolveOld(new Response(JSON.stringify({ collections: [] })));
      await old;
    });
    expect(
      screen.getByRole("article", { name: "题集：数学二新题集" }),
    ).toBeVisible();
    expect(
      fetcher.mock.calls.filter(
        ([path, init]) =>
          path === "/api/study/collections" && init?.method !== "POST",
      ),
    ).toHaveLength(1);
  });

  it("keeps collections available if the independent task request fails, and updates new notebooks without a reload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path === "/api/study/collections")
          return json({ collections: [created] });
        if (path.endsWith("/notebooks"))
          return json(
            { notebook: { id: "new-book", name: "微积分专题" } },
            201,
          );
        if (path.endsWith("/tasks"))
          return json({ error: "任务暂不可用" }, 503);
        if (path.endsWith("/jobs")) return json({ jobs: [] });
        return json({ events: [] });
      }),
    );
    render(<StudyWorkspace />);
    const card = await screen.findByRole("article", {
      name: "题集：数学二新题集",
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("任务暂不可用"),
    );
    fireEvent.click(within(card).getByRole("button", { name: "新增错题本" }));
    fireEvent.change(screen.getByRole("textbox", { name: "新错题本名称" }), {
      target: { value: "微积分专题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加错题本" }));
    expect(
      await screen.findByRole("button", { name: /微积分专题/ }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
