import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  conversationDeleteMany: vi.fn(),
  projectDelete: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: {
      findFirst: mocks.projectFindFirst,
      delete: mocks.projectDelete,
    },
    conversation: {
      deleteMany: mocks.conversationDeleteMany,
    },
    $transaction: mocks.transaction,
  },
}));

import { DELETE } from "@/app/api/projects/[id]/route";

describe("DELETE /api/projects/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1", userId: "user-1" });
    mocks.conversationDeleteMany.mockReturnValue("delete-conversations");
    mocks.projectDelete.mockReturnValue("delete-project");
    mocks.transaction.mockResolvedValue([]);
  });

  it("deletes project conversations before deleting the project", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost/api/projects/project-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.conversationDeleteMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", userId: "user-1" },
    });
    expect(mocks.projectDelete).toHaveBeenCalledWith({
      where: { id: "project-1" },
    });
    expect(mocks.transaction).toHaveBeenCalledWith([
      "delete-conversations",
      "delete-project",
    ]);
  });
});
