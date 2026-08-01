// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listStudyPacks: vi.fn(),
  createStudyPackDraft: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    listStudyPacks: mocks.listStudyPacks,
    createStudyPackDraft: mocks.createStudyPackDraft,
  },
}));

import { GET, POST } from "./route";

const context = {
  params: Promise.resolve({ id: "project-1", goalId: "goal-1" }),
};

const packFixture = {
  id: "pack-1",
  goalId: "goal-1",
  title: "电路基础 · 学习资料包",
  outline: [],
  outlineStatus: "draft",
  sourceFingerprint: "sha256:map",
  publishedArtifactId: null,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
  sections: [],
};

describe("GET/POST learning study packs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listStudyPacks.mockResolvedValue({ packs: [packFixture] });
    mocks.createStudyPackDraft.mockResolvedValue({ pack: packFixture });
  });

  it("lists packs with ownership ids from the authenticated path", async () => {
    const response = await GET(new Request("http://localhost"), context);

    expect(response.status).toBe(200);
    expect(mocks.listStudyPacks).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      goalId: "goal-1",
    });
  });

  it("creates a pack draft and requires an idempotency key", async () => {
    const missing = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ title: "资料包" }),
      }),
      context
    );
    expect(missing.status).toBe(400);
    expect(mocks.createStudyPackDraft).not.toHaveBeenCalled();

    const created = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          title: "资料包",
          idempotencyKey: "pack-1",
        }),
      }),
      context
    );
    expect(created.status).toBe(201);
    expect(mocks.createStudyPackDraft).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      goalId: "goal-1",
      input: { title: "资料包", idempotencyKey: "pack-1" },
    });
  });
});
