// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  generateStudyPack: vi.fn(),
  updateStudyPackOutline: vi.fn(),
  publishStudyPack: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    generateStudyPack: mocks.generateStudyPack,
    updateStudyPackOutline: mocks.updateStudyPackOutline,
    publishStudyPack: mocks.publishStudyPack,
  },
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({ id: "project-1", packId: "pack-1" }),
};

describe("POST study pack generate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.generateStudyPack.mockResolvedValue({
      pack: { id: "pack-1", sections: [] },
      generated: 1,
      skipped: 0,
    });
  });

  it("requires an idempotency key and forwards ownership ids", async () => {
    const missing = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      context
    );
    expect(missing.status).toBe(400);
    expect(mocks.generateStudyPack).not.toHaveBeenCalled();

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "gen-1" }),
      }),
      context
    );
    expect(response.status).toBe(200);
    expect(mocks.generateStudyPack).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      packId: "pack-1",
      input: { idempotencyKey: "gen-1" },
    });
  });
});
