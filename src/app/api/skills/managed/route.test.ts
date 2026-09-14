// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  status: vi.fn(),
  check: vi.fn(),
  rollback: vi.fn(),
  promoteStaged: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/skills/managed-service", () => ({ getManagedSkillsUpdater: () => ({ status: mocks.status, check: mocks.check, rollback: mocks.rollback, promoteStaged: mocks.promoteStaged }) }));

import { GET, POST } from "./route";

describe("Managed Skills management API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKILL_UPDATE_ADMIN_EMAILS = "operator@example.com";
    mocks.auth.mockResolvedValue({ user: { id: "u1", email: "reader@example.com" } });
    mocks.status.mockReturnValue({ schemaVersion: 1, installations: [] });
  });

  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("lets authenticated users inspect status without filesystem paths", async () => {
    mocks.status.mockReturnValue({ schemaVersion: 1, installations: [{
      skillId: "demo", category: "academic", source: { type: "github", url: "https://github.com/example/skills", path: "demo", channel: "main" },
      version: "1.0.0", installedRevision: "abc", contentHash: "hash", policyHash: "policy", installedAt: null,
      lastCheckedAt: null, lastUpdatedAt: null, autoUpdate: true, state: "active", currentPath: "/secret/server/path",
      previous: null, candidate: null, reviewReasons: [], lastError: null, nextCheckAt: null,
    }] });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.operator).toBe(false);
    expect(body.installations[0]).not.toHaveProperty("currentPath");
  });

  it("prevents ordinary users from checking, updating, or rolling back", async () => {
    const response = await POST(new Request("http://localhost/api/skills/managed", { method: "POST", body: JSON.stringify({ action: "check" }) }));
    expect(response.status).toBe(403);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("allows a configured operator to request a safe update", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", email: "operator@example.com" } });
    mocks.check.mockResolvedValue([{ skillId: "demo", status: "promoted" }]);
    const response = await POST(new Request("http://localhost/api/skills/managed", { method: "POST", body: JSON.stringify({ action: "update", skillId: "demo" }) }));
    expect(response.status).toBe(200);
    expect(mocks.check).toHaveBeenCalledWith("demo", true);
  });

  it("allows only an operator to approve an already reviewed candidate", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", email: "operator@example.com" } });
    mocks.promoteStaged.mockResolvedValue({ skillId: "demo", status: "promoted" });
    const response = await POST(new Request("http://localhost/api/skills/managed", { method: "POST", body: JSON.stringify({ action: "approve", skillId: "demo" }) }));
    expect(response.status).toBe(200);
    expect(mocks.promoteStaged).toHaveBeenCalledWith("demo", true);
  });
});
