// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LearningServiceError } from "@/lib/learning/contracts";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getStudyPack: vi.fn(),
  deleteStudyPack: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    getStudyPack: mocks.getStudyPack,
    deleteStudyPack: mocks.deleteStudyPack,
  },
}));

import { DELETE } from "./route";

const context = {
  params: Promise.resolve({ id: "project-1", packId: "pack-1" }),
};

describe("DELETE study pack route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.deleteStudyPack.mockResolvedValue(undefined);
  });

  it("rejects anonymous requests with 401", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      context
    );

    expect(response.status).toBe(401);
    expect(mocks.deleteStudyPack).not.toHaveBeenCalled();
  });

  it("forwards ownership ids and returns success", async () => {
    const response = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      context
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.deleteStudyPack).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      packId: "pack-1",
    });
  });

  it("maps ownership failures to 404", async () => {
    mocks.deleteStudyPack.mockRejectedValue(
      new LearningServiceError("not_found", "学习资料包不存在", 404)
    );

    const response = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      context
    );

    expect(response.status).toBe(404);
  });
});
