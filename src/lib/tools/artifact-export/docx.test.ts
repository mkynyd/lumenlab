// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), render: vi.fn(), getCached: vi.fn(), setCached: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { artifact: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/export/markdown-to-docx", () => ({ markdownToDocx: mocks.render }));
vi.mock("@/lib/cache/export-cache", async (original) => ({
  ...await original<typeof import("@/lib/cache/export-cache")>(),
  getCachedExport: mocks.getCached, setCachedExport: mocks.setCached,
}));
import { encodeDurableAgentEvent } from "@/lib/agent/executions/event-codec";
import { exportArtifactAsDocx } from "./docx";
describe("chat Word export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({ id: "artifact-1", title: "中文教案", content: "# 教案\n\n中文正文", type: "general" });
    mocks.getCached.mockResolvedValue(null);
    mocks.render.mockResolvedValue(Buffer.from("PK-test"));
  });
  it("returns a bounded authenticated download reference using the shared renderer, without binary data in model context", async () => {
    const result = await exportArtifactAsDocx("user-1", "artifact-1");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "artifact-1", userId: "user-1" } }));
    expect(mocks.render).toHaveBeenCalledWith("# 教案\n\n中文正文");
    expect(mocks.setCached).toHaveBeenCalled();
    expect(result).toMatchObject({ artifactId: "artifact-1", filename: "中文教案.docx", downloadUrl: "/api/artifacts/artifact-1/export?format=docx", bytes: 7 });
    expect(result).not.toHaveProperty("base64");
  });
  it("keeps large Word files within durable event limits", async () => {
    mocks.render.mockResolvedValue(Buffer.alloc(100_000, 1));
    const result = await exportArtifactAsDocx("user-1", "artifact-1");
    expect(() => encodeDurableAgentEvent({ schemaVersion: 1, agentExecutionId: "run", sequence: 1,
      type: "agent_event", payload: { eventJson: JSON.stringify({ type: "tool_completed", executionId: "tool", resultSummary: result }) },
    })).not.toThrow();
    expect(JSON.stringify(result).length).toBeLessThan(1000);
    expect(result.bytes).toBe(100_000);
  });

  it("does not generate a download for another user's artifact", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await exportArtifactAsDocx("other-user", "artifact-1")).toEqual({ error: "ARTIFACT_NOT_FOUND" });
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
