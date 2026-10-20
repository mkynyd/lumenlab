import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { toolRegistry } from "./tool-registry";
import "@/lib/tools/registry";
import type { AgentContext, ToolMetadata } from "./types";
import { skillRegistry } from "./skill-registry";
import "@/lib/skills/registry";
import { registerFromDiscovery } from "@/lib/skills/registry";
import type { SkillMetadata } from "./types";

beforeAll(async () => {
  await registerFromDiscovery();
});

const userPrefs: Array<{ userId: string; toolId: string; approvalMode: string }> = [];

vi.mock("@/lib/db", () => ({
  prisma: {
    userToolPreference: {
      findUnique: vi.fn(async ({ where }) => {
        return (
          userPrefs.find(
            (p) => p.userId === where.userId_toolId.userId && p.toolId === where.userId_toolId.toolId
          ) ?? null
        );
      }),
    },
    project: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) => {
        if (where.userId === "user-1" && where.id === "p1") {
          return { id: "p1" };
        }
        return null;
      }),
    },
    fileAsset: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string; projectId?: string } }) => {
        if (
          where.userId === "user-1" &&
          where.id === "f1" &&
          (where.projectId === undefined || where.projectId === "p1")
        ) {
          return { id: "f1", originalName: "test.txt", mimeType: "text/plain" };
        }
        return null;
      }),
    },
  },
}));

beforeEach(async () => {
  userPrefs.length = 0;
  const mod = await import("./policy-engine");
  mod.__clearUserPreferenceCacheForTesting();
});

function ctxWithTool(tool: ToolMetadata, overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    user: { id: "user-1", scopes: ["project.read", "project.write", "artifact.read", "artifact.write"] },
    workspace: { id: "default", policies: [] },
    conversation: {
      id: "conv-1",
      sessionApprovals: new Map(),
    },
    tool,
    arguments: {},
    resourceContext: {},
    ...overrides,
  };
}

describe("policy-engine.evaluatePolicy", () => {
  it("denies tools that are not registered", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool({
        toolId: "ghost.tool",
        name: "Ghost",
        description: "",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "L1",
        isReadOnly: true,
        hasExternalSideEffect: false,
        isReversible: true,
        containsSensitiveData: false,
        requiresNetwork: false,
        defaultApprovalMode: "auto",
        allowedSkillIds: [],
        auditLevel: "minimal",
        requiredScopes: [],
      })
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe("TOOL_NOT_REGISTERED");
  });

  it("allows L1 read-only tool in auto mode", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(ctxWithTool(toolRegistry.require("project_files.list"), {
      arguments: { projectId: "p1" },
    }));
    expect(decision.decision).toBe("allow");
    expect(decision.reasonCode).toBe("AUTO_APPROVED_BY_POLICY");
  });

  it("denies project reads when the user has no persisted scopes", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("project_files.list"), {
        user: { id: "user-1", scopes: [] },
        arguments: { projectId: "p1" },
      })
    );

    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe("SCOPE_NOT_GRANTED");
  });

  it("denies tool not in Skill allowlist", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const skill = skillRegistry.require("paper-writer");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("project_files.delete"), {
        skill,
        arguments: { projectId: "p1", fileId: "f1" },
      })
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe("TOOL_NOT_IN_SKILL_ALLOWLIST");
  });

  it.each(["web.search", "web.fetch"])("honors turn-level web access for %s alongside a document skill", async (toolId) => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(ctxWithTool(toolRegistry.require(toolId), {
      skill: skillRegistry.require("pptx"),
      user: { id: "user-1", scopes: [] },
      webSearchActive: true,
      arguments: toolId === "web.search" ? { query: "2026年3月时事" } : { url: "https://example.com" },
    }));
    expect(decision.decision).toBe("allow");
  });

  it("does not accept web access from tool arguments or bypass non-web skill restrictions", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const skill = skillRegistry.require("pptx");
    const web = await evaluatePolicy(ctxWithTool(toolRegistry.require("web.search"), {
      skill, arguments: { query: "时事", webSearchActive: true },
    }));
    expect(web.reasonCode).toBe("TOOL_NOT_IN_SKILL_ALLOWLIST");
    const deletion = await evaluatePolicy(ctxWithTool(toolRegistry.require("project_files.delete"), {
      skill, webSearchActive: true, arguments: { projectId: "p1", fileId: "f1" },
    }));
    expect(deletion.reasonCode).toBe("TOOL_NOT_IN_SKILL_ALLOWLIST");
  });

  it("still applies workspace, user preference, and argument checks to enabled web tools", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const context = ctxWithTool(toolRegistry.require("web.search"), {
      skill: skillRegistry.require("pptx"), webSearchActive: true, arguments: { query: "时事" },
    });
    expect((await evaluatePolicy({ ...context, workspace: {
      id: "default", policies: [{ toolId: "web.search", mode: "block" }],
    } })).reasonCode).toBe("WORKSPACE_BLOCKED");
    expect((await evaluatePolicy({ ...context, arguments: { query: 42 } })).reasonCode).toBe("INVALID_ARGUMENTS");
    userPrefs.push({ userId: "user-1", toolId: "web.search", approvalMode: "ask_each" });
    expect((await evaluatePolicy(context)).decision).toBe("allow");
  });

  it("allows skill.activate regardless of Skill allowlist", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const skill = skillRegistry.require("code-reader");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("skill.activate"), {
        skill,
        arguments: { name: "web-search" },
      })
    );
    expect(decision.decision).toBe("allow");
  });

  it("denies tool whose risk exceeds Skill ceiling", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const overrideSkill: SkillMetadata = {
      skillId: "temp-skill",
      version: "1.0.0",
      description: "test",
      instructions: "",
      allowedTools: ["project_files.delete"],
      allowedRiskLevel: ["L1"],
      requiredScopes: [],
      defaultApprovalPolicy: "auto",
      inputContract: {},
      outputContract: {},
      dataHandlingPolicy: { maySendToExternal: false, mayPersist: false },
    };
    skillRegistry.register(overrideSkill);
    try {
      const decision = await evaluatePolicy(
        ctxWithTool(toolRegistry.require("project_files.delete"), {
          skill: overrideSkill,
          arguments: { projectId: "p1", fileId: "f1" },
        })
      );
      expect(decision.decision).toBe("deny");
      expect(decision.reasonCode).toBe("TOOL_RISK_EXCEEDS_SKILL_CEILING");
    } finally {
      skillRegistry.reset();
      // restore builtins via re-import
      await import("@/lib/skills/registry");
    }
  });

  it("denies via workspace block", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("project_files.list"), {
        workspace: {
          id: "ws",
          policies: [{ toolId: "project_files.list", mode: "block", reason: "禁用" }],
        },
        arguments: { projectId: "p1" },
      })
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe("WORKSPACE_BLOCKED");
  });

  it("rejects arguments missing required fields", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("project_files.read"), {
        arguments: {},
      })
    );
    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe("INVALID_ARGUMENTS");
  });

  it("continues to honor explicit user blocks under automatic execution", async () => {
    userPrefs.push({ userId: "user-1", toolId: "artifact.save", approvalMode: "block" });
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(ctxWithTool(toolRegistry.require("artifact.save"), { arguments: { title: "T", content: "C" } }));
    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe("USER_BLOCKED");
  });

  it("automatically executes L2 saves", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("artifact.save"), {
        arguments: { title: "T", content: "C" },
      })
    );
    expect(decision.decision).toBe("allow");
    expect(decision.reasonCode).toBe("AUTO_APPROVED_BY_POLICY");
  });

  it("automatically executes allowed L3 tools", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("project_files.delete"), {
        arguments: { projectId: "p1", fileId: "f1" },
      })
    );
    expect(decision.decision).toBe("allow");
    expect(decision.approvalRequired).toBe(false);
  });

  it("keeps L3 automatic when a stored preference is auto", async () => {
    userPrefs.push({
      userId: "user-1",
      toolId: "project_files.delete",
      approvalMode: "auto",
    });
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("project_files.delete"), {
        arguments: { projectId: "p1", fileId: "f1" },
      })
    );
    expect(decision.decision).toBe("allow");
    expect(decision.approvalRequired).toBe(false);
  });

  it("respects session pre-approval for L1", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const conversation = {
      id: "conv-1",
      sessionApprovals: new Map([["project_files.list", "session" as const]]),
    };
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("project_files.list"), {
        conversation,
        arguments: { projectId: "p1" },
      })
    );
    expect(decision.decision).toBe("allow");
    expect(decision.reasonCode).toBe("AUTO_APPROVED_BY_POLICY");
  });

  it("automatically executes tools with legacy ask_each preferences", async () => {
    userPrefs.push({
      userId: "user-1",
      toolId: "artifact.save",
      approvalMode: "ask_each",
    });
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("artifact.save"), {
        arguments: { title: "T", content: "C" },
      })
    );
    expect(decision.decision).toBe("allow");
    expect(decision.reasonCode).toBe("AUTO_APPROVED_BY_POLICY");
  });
});
