import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  messageFindFirst: vi.fn(),
  artifactCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    message: { findFirst: mocks.messageFindFirst },
    artifact: { create: mocks.artifactCreate },
  },
}));

import { saveArtifact } from "./save";

describe("saveArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageFindFirst.mockResolvedValue(null);
    mocks.artifactCreate.mockResolvedValue({
      id: "artifact-1",
      title: "Notes",
      type: "general",
      createdAt: new Date("2026-07-12T08:00:00.000Z"),
    });
  });

  it("rejects a project that is not owned by the requesting user", async () => {
    mocks.projectFindFirst.mockResolvedValue(null);

    await expect(
      saveArtifact(
        "user-1",
        "project-owned-by-user-2",
        "conversation-1",
        undefined,
        { title: "Notes", content: "Private content" }
      )
    ).rejects.toThrow("项目不存在或无访问权限");

    expect(mocks.artifactCreate).not.toHaveBeenCalled();
  });

  it("saves an artifact after confirming project ownership", async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1" });

    await expect(
      saveArtifact("user-1", "project-1", "conversation-1", undefined, {
        title: "Notes",
        content: "Course notes",
      })
    ).resolves.toEqual({
      id: "artifact-1",
      title: "Notes",
      type: "general",
      createdAt: "2026-07-12T08:00:00.000Z",
    });
    expect(mocks.artifactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        projectId: "project-1",
        conversationId: "conversation-1",
      }),
      select: { id: true, title: true, type: true, createdAt: true },
    });
  });
});
