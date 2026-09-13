import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const { useResearchLaunch } = await import("./use-research-launch");

function attachment(id: string, name: string) {
  return { id, name, mimeType: "application/pdf", size: 10, data: new File(["x"], name) };
}

const baseInput = {
  question: "比较两种 MoE 路由方法在近五年的适用边界",
  budgetProfile: "deep" as const,
  commanderModel: "qwen3.8-flash",
  domainProfileKey: "computer_science",
};

function setupSuccessRoutes() {
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (url === "/api/projects") return { project: { id: "proj-1" } };
    if (url === "/api/projects/proj-1/files") return { files: [{ id: "f-1" }], errors: [], summary: { total: 1, succeeded: 1, failed: 0 } };
    if (url === "/api/research/workspaces") return { workspace: { id: "ws-1" } };
    if (url === "/api/research/workspaces/ws-1/runs") return { run: { id: "run-1" } };
    throw new Error(`unexpected url ${url}`);
  });
}

beforeEach(() => {
  fetchJsonMock.mockReset();
});

describe("useResearchLaunch", () => {
  it("creates project, uploads files, creates workspace then run in order", async () => {
    setupSuccessRoutes();
    const { result } = renderHook(() => useResearchLaunch());
    const files = [attachment("a1", "paper-a.pdf"), attachment("a2", "paper-b.pdf")];
    let launchResult: Awaited<ReturnType<typeof result.current.launch>> = null;
    await act(async () => {
      launchResult = await result.current.launch({ ...baseInput, attachments: files });
    });

    expect(launchResult).toEqual({ workspaceId: "ws-1", runId: "run-1" });
    const urls = fetchJsonMock.mock.calls.map((call) => call[0] as string);
    expect(urls).toEqual([
      "/api/projects",
      "/api/projects/proj-1/files",
      "/api/projects/proj-1/files",
      "/api/research/workspaces",
      "/api/research/workspaces/ws-1/runs",
    ]);

    const projectBody = JSON.parse(fetchJsonMock.mock.calls[0][1].body as string) as { name: string; type: string };
    expect(projectBody.type).toBe("general");
    expect(projectBody.name).toContain("研究资料");
    expect(projectBody.name.length).toBeLessThanOrEqual(40);

    const uploadInit = fetchJsonMock.mock.calls[1][1] as { body: FormData };
    expect(uploadInit.body.get("category")).toBe("通用");
    expect(uploadInit.body.getAll("files")).toHaveLength(1);

    const workspaceBody = JSON.parse(fetchJsonMock.mock.calls[3][1].body as string) as Record<string, unknown>;
    expect(workspaceBody).toMatchObject({ projectId: "proj-1", budgetProfile: "deep", domainProfileKey: "computer_science" });
    expect(typeof workspaceBody.name).toBe("string");
    expect((workspaceBody.name as string).length).toBeLessThanOrEqual(41);

    const runBody = JSON.parse(fetchJsonMock.mock.calls[4][1].body as string) as Record<string, unknown>;
    expect(runBody).toEqual({ question: baseInput.question, budgetProfile: "deep", commanderModel: "qwen3.8-flash" });
  });

  it("skips project creation when there are no attachments", async () => {
    setupSuccessRoutes();
    const { result } = renderHook(() => useResearchLaunch());
    await act(async () => {
      await result.current.launch({ ...baseInput, attachments: [] });
    });
    const urls = fetchJsonMock.mock.calls.map((call) => call[0] as string);
    expect(urls).toEqual(["/api/research/workspaces", "/api/research/workspaces/ws-1/runs"]);
    const workspaceBody = JSON.parse(fetchJsonMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(workspaceBody.projectId).toBeUndefined();
  });

  it("pauses for a decision when every attachment fails, then continues without files", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === "/api/projects") return { project: { id: "proj-1" } };
      if (url === "/api/projects/proj-1/files") throw new Error("文件保存失败");
      if (url === "/api/research/workspaces") return { workspace: { id: "ws-1" } };
      if (url === "/api/research/workspaces/ws-1/runs") return { run: { id: "run-1" } };
      throw new Error(`unexpected url ${url}`);
    });
    const { result } = renderHook(() => useResearchLaunch());
    let launchResult: Awaited<ReturnType<typeof result.current.launch>> = null;
    await act(async () => {
      launchResult = await result.current.launch({ ...baseInput, attachments: [attachment("a1", "paper.pdf")] });
    });
    expect(launchResult).toBeNull();
    expect(result.current.phase).toBe("awaiting_attachment_decision");
    expect(result.current.attachmentStates).toEqual([{ id: "a1", name: "paper.pdf", status: "failed", error: "文件保存失败" }]);

    await act(async () => {
      launchResult = await result.current.continueWithoutFiles();
    });
    expect(launchResult).toEqual({ workspaceId: "ws-1", runId: "run-1" });
    const workspaceCall = fetchJsonMock.mock.calls.find((call) => call[0] === "/api/research/workspaces");
    const workspaceBody = JSON.parse(workspaceCall?.[1].body as string) as Record<string, unknown>;
    expect(workspaceBody.projectId).toBeUndefined();
  });

  it("continues with a notice when only some attachments fail", async () => {
    let uploads = 0;
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === "/api/projects") return { project: { id: "proj-1" } };
      if (url === "/api/projects/proj-1/files") {
        uploads += 1;
        if (uploads === 1) throw new Error("文件保存失败");
        return { files: [{ id: "f-1" }], errors: [], summary: { total: 1, succeeded: 1, failed: 0 } };
      }
      if (url === "/api/research/workspaces") return { workspace: { id: "ws-1" } };
      if (url === "/api/research/workspaces/ws-1/runs") return { run: { id: "run-1" } };
      throw new Error(`unexpected url ${url}`);
    });
    const { result } = renderHook(() => useResearchLaunch());
    let launchResult: Awaited<ReturnType<typeof result.current.launch>> = null;
    await act(async () => {
      launchResult = await result.current.launch({ ...baseInput, attachments: [attachment("a1", "bad.pdf"), attachment("a2", "good.pdf")] });
    });
    expect(launchResult).toEqual({ workspaceId: "ws-1", runId: "run-1" });
    expect(result.current.notice).toContain("1 个附件上传失败");
    const workspaceCall = fetchJsonMock.mock.calls.find((call) => call[0] === "/api/research/workspaces");
    const workspaceBody = JSON.parse(workspaceCall?.[1].body as string) as Record<string, unknown>;
    expect(workspaceBody.projectId).toBe("proj-1");
  });

  it("reports a retryable error when workspace creation fails", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === "/api/research/workspaces") throw new Error("创建研究区失败");
      if (url === "/api/research/workspaces/ws-1/runs") return { run: { id: "run-1" } };
      throw new Error(`unexpected url ${url}`);
    });
    const { result } = renderHook(() => useResearchLaunch());
    let launchResult: Awaited<ReturnType<typeof result.current.launch>> = null;
    await act(async () => {
      launchResult = await result.current.launch({ ...baseInput, attachments: [] });
    });
    expect(launchResult).toBeNull();
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("创建研究区失败");

    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === "/api/research/workspaces") return { workspace: { id: "ws-1" } };
      if (url === "/api/research/workspaces/ws-1/runs") return { run: { id: "run-1" } };
      throw new Error(`unexpected url ${url}`);
    });
    await act(async () => {
      launchResult = await result.current.retry();
    });
    expect(launchResult).toEqual({ workspaceId: "ws-1", runId: "run-1" });
  });
});
