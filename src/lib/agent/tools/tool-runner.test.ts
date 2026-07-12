import { describe, expect, it } from "vitest";
import { createToolRunner } from "./tool-runner";
import type { PolicyDecision, ToolMetadata } from "../types";

describe("ToolRunner", () => {
  it("persists each automatic execution state before emitting its event", async () => {
    const operations: string[] = [];
    let proposalContext: {
      projectId?: string;
      selectedFileIds?: string[];
    } | undefined;
    const tool = metadata("project_files.list");
    const runner = createToolRunner({
      resolveTool: () => tool,
      resolveSkill: () => undefined,
      evaluatePolicy: async () => allow(tool),
      issueApproval: async () => {
        throw new Error("approval should not be issued");
      },
      persistence: {
        loadSessionApprovals: async () => new Map(),
        propose: async (input) => {
          operations.push("persist:proposed");
          proposalContext = input.contextSnapshot;
          return { id: "execution-1" };
        },
        markBlocked: async () => { operations.push("persist:blocked"); },
        markPendingApproval: async () => { operations.push("persist:pending_approval"); },
        claimApprovedExecution: async () => {
          operations.push("persist:approved");
          return true;
        },
        markExecuting: async () => { operations.push("persist:executing"); },
        markSucceeded: async () => { operations.push("persist:succeeded"); },
        markFailed: async () => { operations.push("persist:failed"); },
      },
      execute: async () => {
        operations.push("handler");
        return { ok: true, result: { files: ["notes.md"] } };
      },
      audit: async (event) => { operations.push(`audit:${event.eventType}`); },
    });

    const result = await runner.run(
      {
        call: {
          id: "call-1",
          toolId: "project_files.list",
          arguments: { projectId: "project-1" },
        },
        context: {
          userId: "user-1",
          conversationId: "conversation-1",
          projectId: "project-1",
          selectedFileIds: ["file-1"],
          sessionApprovals: new Map(),
        },
      },
      (event) => operations.push(`emit:${event.type}`)
    );

    expect(result).toEqual({
      status: "succeeded",
      executionId: "execution-1",
      summary: { files: ["notes.md"] },
    });
    expect(proposalContext).toEqual({
      projectId: "project-1",
      selectedFileIds: ["file-1"],
    });
    expect(operations).toEqual([
      "persist:proposed",
      "audit:tool_proposed",
      "emit:tool_proposed",
      "persist:executing",
      "audit:tool_started",
      "emit:tool_started",
      "handler",
      "persist:succeeded",
      "audit:tool_completed",
      "emit:tool_completed",
    ]);
  });

  it.each([
    ["L2", true],
    ["L3", false],
  ] as const)(
    "emits an explicit session-approval capability for %s tools",
    async (riskLevel, canApproveSession) => {
      const tool = { ...metadata("approval_test.tool"), riskLevel };
      const events: Array<Record<string, unknown>> = [];
      const runner = createToolRunner({
        resolveTool: () => tool,
        resolveSkill: () => undefined,
        evaluatePolicy: async () => requireApproval(tool),
        issueApproval: async () => ({
          token: "approval-token",
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        }),
        persistence: {
          loadSessionApprovals: async () => new Map(),
          propose: async () => ({ id: "execution-pending" }),
          markBlocked: async () => {},
          markPendingApproval: async () => {},
          claimApprovedExecution: async () => true,
          markExecuting: async () => {},
          markSucceeded: async () => {},
          markFailed: async () => {},
        },
        execute: async () => {
          throw new Error("pending approvals must not execute");
        },
        audit: async () => {},
      });

      const result = await runner.run(
        {
          call: {
            id: "call-pending",
            toolId: tool.toolId,
            arguments: {},
          },
          context: {
            userId: "user-1",
            conversationId: "conversation-1",
            sessionApprovals: new Map(),
          },
        },
        (event) => events.push(event)
      );

      expect(result).toEqual({
        status: "pending_approval",
        executionId: "execution-pending",
      });
      expect(events.at(-1)).toMatchObject({
        type: "approval_required",
        canApproveSession,
      });
    }
  );

  it("persists cancellation and never calls a handler after the request aborts", async () => {
    const operations: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const tool = metadata("project_files.list");
    const runner = createToolRunner({
      resolveTool: () => tool,
      resolveSkill: () => undefined,
      evaluatePolicy: async () => allow(tool),
      issueApproval: async () => {
        throw new Error("approval should not be issued");
      },
      persistence: {
        loadSessionApprovals: async () => new Map(),
        propose: async () => {
          operations.push("persist:proposed");
          return { id: "execution-aborted" };
        },
        markBlocked: async () => {},
        markPendingApproval: async () => {},
        claimApprovedExecution: async () => true,
        markExecuting: async () => {
          operations.push("persist:executing");
        },
        markSucceeded: async () => {
          operations.push("persist:succeeded");
        },
        markFailed: async () => {
          operations.push("persist:failed");
        },
      },
      execute: async () => {
        operations.push("handler");
        return { ok: true, result: {} };
      },
      audit: async (event) => {
        operations.push(`audit:${event.eventType}`);
      },
    });

    const result = await runner.run(
      {
        call: { id: "call-aborted", toolId: tool.toolId, arguments: {} },
        context: {
          userId: "user-1",
          conversationId: "conversation-1",
          signal: controller.signal,
          sessionApprovals: new Map(),
        },
      },
      (event) => operations.push(`emit:${event.type}`)
    );

    expect(result).toMatchObject({
      status: "failed",
      code: "REQUEST_ABORTED",
    });
    expect(operations).not.toContain("handler");
    expect(operations).not.toContain("persist:executing");
    expect(operations).toContain("persist:failed");
  });
});

function metadata(toolId: string): ToolMetadata {
  return {
    toolId,
    name: toolId,
    description: "List project files",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {},
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: [],
  };
}

function allow(tool: ToolMetadata): PolicyDecision {
  return {
    decision: "allow",
    reasonCode: "AUTO_APPROVED_BY_POLICY",
    riskLevel: tool.riskLevel,
    approvalRequired: false,
    sanitizedPreview: {
      toolId: tool.toolId,
      toolName: tool.name,
      summary: "List project files",
      affectedResources: [],
      sendsToExternal: false,
      isReversible: true,
      dataTypes: [],
    },
    auditRequirements: "standard",
  };
}

function requireApproval(tool: ToolMetadata): PolicyDecision {
  return {
    decision: "require_approval",
    reasonCode: "POLICY_REQUIRES_APPROVAL",
    riskLevel: tool.riskLevel,
    approvalRequired: true,
    approvalScope: "once",
    sanitizedPreview: {
      toolId: tool.toolId,
      toolName: tool.name,
      summary: "Approve tool",
      affectedResources: [],
      sendsToExternal: false,
      isReversible: tool.isReversible,
      dataTypes: [],
    },
    auditRequirements: "standard",
  };
}
