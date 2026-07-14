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

  it("requires approval for L2 artifact.save on first use (ask_first)", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("artifact.save"), {
        arguments: { title: "T", content: "C" },
      })
    );
    expect(decision.decision).toBe("require_approval");
    expect(decision.reasonCode).toBe("FIRST_TIME_USE_REQUIRES_APPROVAL");
  });

  it("always requires approval for L3 project_files.delete", async () => {
    const { evaluatePolicy } = await import("./policy-engine");
    const decision = await evaluatePolicy(
      ctxWithTool(toolRegistry.require("project_files.delete"), {
        arguments: { projectId: "p1", fileId: "f1" },
      })
    );
    expect(decision.decision).toBe("require_approval");
    expect(decision.approvalScope).toBe("once");
  });

  it("forces ask_each for L3 even if user prefers auto", async () => {
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
    expect(decision.decision).toBe("require_approval");
    expect(decision.approvalRequired).toBe(true);
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
    expect(decision.reasonCode).toBe("SESSION_PRE_APPROVED");
  });

  it("applies user preference to make ask_each stricter than auto", async () => {
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
    expect(decision.decision).toBe("require_approval");
    expect(decision.reasonCode).toBe("POLICY_REQUIRES_APPROVAL");
  });
});
