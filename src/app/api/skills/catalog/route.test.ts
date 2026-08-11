// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  ensureDiscovery: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/agent/skill-registry", () => ({
  skillRegistry: { list: mocks.list },
}));
vi.mock("@/lib/skills/registry", () => ({
  ensureDiscovery: mocks.ensureDiscovery,
}));

import { GET } from "./route";

function skill(overrides: Record<string, unknown>) {
  return {
    skillId: "skill-1",
    displayName: "技能一",
    description: "描述",
    version: "1.0.0",
    category: "academic",
    allowedRiskLevel: ["L1"],
    defaultApprovalPolicy: "auto",
    dataHandlingPolicy: { maySendToExternal: false },
    ...overrides,
  };
}

describe("GET skills catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.ensureDiscovery.mockResolvedValue(undefined);
  });

  it("rejects anonymous requests with 401", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("includes the document category instead of dropping it", async () => {
    mocks.list.mockReturnValue([
      skill({ skillId: "paper-reader", category: "academic" }),
      skill({ skillId: "docx", displayName: "Word 文档", category: "document" }),
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    const slugs = body.categories.map((c: { slug: string }) => c.slug);
    expect(slugs).toEqual(["academic", "document"]);
    const document = body.categories.find(
      (c: { slug: string }) => c.slug === "document"
    );
    expect(document.displayName).toBe("文档处理");
    expect(document.skills).toHaveLength(1);
    // 分类中的技能总数应与 totalCount 一致（无静默丢弃）
    const grouped = body.categories.reduce(
      (sum: number, c: { skills: unknown[] }) => sum + c.skills.length,
      0
    );
    expect(grouped).toBe(body.totalCount);
  });

  it("keeps unknown categories before uncategorized", async () => {
    mocks.list.mockReturnValue([
      skill({ skillId: "new-kind", category: "multimodal" }),
      skill({ skillId: "legacy", category: undefined }),
    ]);

    const response = await GET();
    const body = await response.json();

    const slugs = body.categories.map((c: { slug: string }) => c.slug);
    expect(slugs).toEqual(["multimodal", "uncategorized"]);
  });
});
