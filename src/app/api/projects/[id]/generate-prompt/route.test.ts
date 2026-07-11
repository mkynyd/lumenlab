import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindUnique: vi.fn(),
  projectUpdate: vi.fn(),
  generateProjectPrompt: vi.fn(),
  generateQuickActions: vi.fn(),
  getProviderApiKey: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { project: {
  findUnique: mocks.projectFindUnique,
  update: mocks.projectUpdate,
} } }));
vi.mock("@/lib/classification", () => ({
  generateProjectPrompt: mocks.generateProjectPrompt,
  generateQuickActions: mocks.generateQuickActions,
}));
vi.mock("@/lib/data/provider-access", () => ({
  getProviderApiKey: mocks.getProviderApiKey,
}));

import { POST } from "./route";

describe("POST /api/projects/[id]/generate-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.projectFindUnique.mockResolvedValue({ userId: "user-1" });
    mocks.projectUpdate.mockResolvedValue({ id: "project-1" });
    mocks.getProviderApiKey.mockResolvedValue("sk-test");
  });

  it("returns a usable deterministic configuration when the model returns empty content", async () => {
    mocks.generateProjectPrompt.mockResolvedValue("");
    mocks.generateQuickActions.mockResolvedValue([]);

    const response = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ userInput: "整理网络安全实习资料", mode: "review" }),
    }), { params: Promise.resolve({ id: "project-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.systemPrompt).toContain("整理网络安全实习资料");
    expect(body.quickActions.length).toBeGreaterThan(0);
    expect(mocks.projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { systemPrompt: body.systemPrompt },
    });
  });
});
