import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type ExecutionRow = {
  id: string;
  userId: string;
  conversationId: string;
  skillId: string | null;
  toolId: string;
  normalizedArguments: Record<string, unknown>;
  argumentsHash: string;
  riskLevel: string;
  status: string;
  approvalScope: string | null;
  approvedAt: Date | null;
  executedAt: Date | null;
  completedAt: Date | null;
  resultSummary: Record<string, unknown> | null;
  errorSummary: Record<string, unknown> | null;
  auditMetadata: Record<string, unknown> | null;
};

type TokenRow = {
  id: string;
  tokenHash: string;
  userId: string;
  conversationId: string;
  toolId: string;
  argumentsHash: string;
  requestId: string;
  consumedAt: Date | null;
  expiresAt: Date;
};

const state = vi.hoisted(() => ({
  authenticatedUserId: "user-1",
  executions: new Map<string, ExecutionRow>(),
  tokens: new Map<string, TokenRow>(),
  audits: [] as Array<Record<string, unknown>>,
  nextTokenId: 1,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: state.authenticatedUserId } })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    toolExecution: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = state.executions.get(where.id);
        return row
          ? {
              ...row,
              normalizedArguments: { ...row.normalizedArguments },
              auditMetadata: row.auditMetadata
                ? { ...row.auditMetadata }
                : null,
            }
          : null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ExecutionRow>;
        }) => {
          const row = state.executions.get(where.id);
          if (!row) throw new Error("execution not found");
          Object.assign(row, data);
          return row;
        }
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string };
          data: Partial<ExecutionRow>;
        }) => {
          const row = state.executions.get(where.id);
          if (!row || (where.status && row.status !== where.status)) {
            return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        }
      ),
    },
    approvalToken: {
      create: vi.fn(
        async ({ data }: { data: Omit<TokenRow, "id" | "consumedAt"> }) => {
          const row: TokenRow = {
            ...data,
            id: `token-${state.nextTokenId++}`,
            consumedAt: null,
          };
          state.tokens.set(row.id, row);
          return row;
        }
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<TokenRow>;
        }) => {
          const row = state.tokens.get(where.id);
          if (!row) throw new Error("token not found");
          Object.assign(row, data);
          return row;
        }
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { tokenHash: string } }) => {
          const row = [...state.tokens.values()].find(
            (item) => item.tokenHash === where.tokenHash
          );
          return row ? { ...row } : null;
        }
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; consumedAt?: null };
          data: Partial<TokenRow>;
        }) => {
          const row = state.tokens.get(where.id);
          if (!row || (where.consumedAt === null && row.consumedAt !== null)) {
            return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        }
      ),
    },
    agentAuditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.audits.push(data);
        return data;
      }),
    },
  },
}));

import { hashArguments, issueApprovalToken } from "@/lib/agent/approval-token";
import { registerToolHandler } from "@/lib/agent/tool-executor";
import { POST } from "./route";

describe("POST /api/agent/approve", () => {
  beforeEach(() => {
    state.authenticatedUserId = "user-1";
    state.executions.clear();
    state.tokens.clear();
    state.audits.length = 0;
    state.nextTokenId = 1;
  });

  it("does not consume a token before validating ToolExecution ownership", async () => {
    const args = { projectId: "project-1", fileId: "file-1" };
    state.executions.set(
      "execution-1",
      execution({ id: "execution-1", userId: "different-user", args })
    );
    const issued = await issueApprovalToken({
      userId: "different-user",
      conversationId: "conversation-1",
      toolId: "project_files.delete",
      argumentsHash: hashArguments(args),
      requestId: "execution-1",
    });

    const response = await POST(approveRequest({
      token: issued.token,
      executionId: "execution-1",
      arguments: args,
      scope: "once",
    }));

    expect(response.status).toBe(404);
    expect([...state.tokens.values()][0].consumedAt).toBeNull();
  });

  it("does not consume a token when ToolExecution is no longer pending", async () => {
    const args = { projectId: "project-1" };
    const row = execution({ id: "execution-finished", args });
    row.status = "succeeded";
    state.executions.set(row.id, row);
    const issued = await issueApprovalToken({
      userId: "user-1",
      conversationId: "conversation-1",
      toolId: row.toolId,
      argumentsHash: hashArguments(args),
      requestId: row.id,
    });

    const response = await POST(approveRequest({
      token: issued.token,
      executionId: row.id,
      scope: "once",
    }));

    expect(response.status).toBe(409);
    expect([...state.tokens.values()][0].consumedAt).toBeNull();
  });

  it("executes the tool with persisted normalized arguments after approval", async () => {
    const persistedArgs = { projectId: "project-1", title: "真实标题" };
    const receivedArguments: Array<Record<string, unknown>> = [];
    registerToolHandler("approval_test.execute", async (_context, args) => {
      receivedArguments.push(args);
      return { saved: true, title: args.title };
    });
    state.executions.set(
      "execution-2",
      execution({
        id: "execution-2",
        toolId: "approval_test.execute",
        riskLevel: "L2",
        args: persistedArgs,
      })
    );
    const issued = await issueApprovalToken({
      userId: "user-1",
      conversationId: "conversation-1",
      toolId: "approval_test.execute",
      argumentsHash: hashArguments(persistedArgs),
      requestId: "execution-2",
    });

    const response = await POST(approveRequest({
      token: issued.token,
      executionId: "execution-2",
      arguments: { projectId: "project-1", title: "被篡改的标题" },
      scope: "once",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: "succeeded",
      executionId: "execution-2",
      resultSummary: { saved: true, title: "真实标题" },
    });
    expect(receivedArguments).toEqual([persistedArgs]);
    expect(state.executions.get("execution-2")).toMatchObject({
      status: "succeeded",
      approvalScope: "once",
      resultSummary: { saved: true, title: "真实标题" },
    });
  });

  it.each([
    ["user", { userId: "different-user" }],
    ["conversation", { conversationId: "different-conversation" }],
    ["tool", { toolId: "different-tool" }],
    ["request", { requestId: "different-execution" }],
  ])(
    "rejects a token with a mismatched %s binding before consuming it",
    async (_binding, override) => {
      const args = { projectId: "project-1", title: "标题" };
      registerToolHandler("approval_test.execute", async () => ({ saved: true }));
      state.executions.set(
        "execution-3",
        execution({
          id: "execution-3",
          toolId: "approval_test.execute",
          riskLevel: "L2",
          args,
        })
      );
      const issued = await issueApprovalToken({
        userId: "user-1",
        conversationId: "conversation-1",
        toolId: "approval_test.execute",
        argumentsHash: hashArguments(args),
        requestId: "execution-3",
        ...override,
      });

      const response = await POST(approveRequest({
        token: issued.token,
        executionId: "execution-3",
        scope: "once",
      }));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload).toMatchObject({ ok: false, reason: "BINDING_MISMATCH" });
      expect([...state.tokens.values()][0].consumedAt).toBeNull();
      expect(state.executions.get("execution-3")?.status).toBe(
        "pending_approval"
      );
    }
  );

  it.each(["L3", "L4"])(
    "does not allow session approval for %s tools",
    async (riskLevel) => {
      const executionId = `execution-${riskLevel}`;
      const args = { projectId: "project-1", fileId: "file-1" };
      registerToolHandler("approval_test.dangerous", async () => ({ deleted: true }));
      state.executions.set(
        executionId,
        execution({
          id: executionId,
          toolId: "approval_test.dangerous",
          riskLevel,
          args,
        })
      );
      const issued = await issueApprovalToken({
        userId: "user-1",
        conversationId: "conversation-1",
        toolId: "approval_test.dangerous",
        argumentsHash: hashArguments(args),
        requestId: executionId,
      });

      const response = await POST(approveRequest({
        token: issued.token,
        executionId,
        scope: "session",
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "L3/L4 工具不支持会话级批准",
      });
      expect([...state.tokens.values()][0].consumedAt).toBeNull();
      expect(state.executions.get(executionId)?.status).toBe("pending_approval");
    }
  );

  it("persists a failed terminal state when the approved handler fails", async () => {
    const args = { projectId: "project-1" };
    registerToolHandler("approval_test.fail", async () => {
      throw new Error("simulated handler failure");
    });
    state.executions.set(
      "execution-failed",
      execution({
        id: "execution-failed",
        toolId: "approval_test.fail",
        riskLevel: "L2",
        args,
      })
    );
    const issued = await issueApprovalToken({
      userId: "user-1",
      conversationId: "conversation-1",
      toolId: "approval_test.fail",
      argumentsHash: hashArguments(args),
      requestId: "execution-failed",
    });

    const response = await POST(approveRequest({
      token: issued.token,
      executionId: "execution-failed",
      scope: "once",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: false,
      status: "failed",
      error: { code: "HANDLER_ERROR", message: "simulated handler failure" },
    });
    expect(state.executions.get("execution-failed")).toMatchObject({
      status: "failed",
      errorSummary: {
        code: "HANDLER_ERROR",
        message: "simulated handler failure",
      },
    });
  });

  it("claims a one-time token atomically so concurrent approvals execute once", async () => {
    const args = { projectId: "project-1" };
    let invocationCount = 0;
    registerToolHandler("approval_test.concurrent", async () => {
      invocationCount += 1;
      await Promise.resolve();
      return { invocationCount };
    });
    state.executions.set(
      "execution-concurrent",
      execution({
        id: "execution-concurrent",
        toolId: "approval_test.concurrent",
        riskLevel: "L2",
        args,
      })
    );
    const issued = await issueApprovalToken({
      userId: "user-1",
      conversationId: "conversation-1",
      toolId: "approval_test.concurrent",
      argumentsHash: hashArguments(args),
      requestId: "execution-concurrent",
    });

    const [first, second] = await Promise.all([
      POST(approveRequest({
        token: issued.token,
        executionId: "execution-concurrent",
        scope: "once",
      })),
      POST(approveRequest({
        token: issued.token,
        executionId: "execution-concurrent",
        scope: "once",
      })),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 400]);
    expect(invocationCount).toBe(1);
    expect(state.executions.get("execution-concurrent")?.status).toBe("succeeded");
  });

  it("claims the pending ToolExecution atomically even if duplicate tokens exist", async () => {
    const args = { projectId: "project-1" };
    let invocationCount = 0;
    registerToolHandler("approval_test.duplicate_tokens", async () => {
      invocationCount += 1;
      await Promise.resolve();
      return { invocationCount };
    });
    state.executions.set(
      "execution-duplicate-tokens",
      execution({
        id: "execution-duplicate-tokens",
        toolId: "approval_test.duplicate_tokens",
        riskLevel: "L2",
        args,
      })
    );
    const tokenInput = {
      userId: "user-1",
      conversationId: "conversation-1",
      toolId: "approval_test.duplicate_tokens",
      argumentsHash: hashArguments(args),
      requestId: "execution-duplicate-tokens",
    };
    const [firstToken, secondToken] = await Promise.all([
      issueApprovalToken(tokenInput),
      issueApprovalToken(tokenInput),
    ]);

    const [first, second] = await Promise.all([
      POST(approveRequest({
        token: firstToken.token,
        executionId: "execution-duplicate-tokens",
        scope: "once",
      })),
      POST(approveRequest({
        token: secondToken.token,
        executionId: "execution-duplicate-tokens",
        scope: "once",
      })),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(invocationCount).toBe(1);
    expect(state.executions.get("execution-duplicate-tokens")?.status).toBe(
      "succeeded"
    );
  });

  it("restores the proposal context when approved arguments omit project scope", async () => {
    const args = { title: "项目成果", content: "正文" };
    const receivedContexts: Array<{
      projectId?: string;
      selectedFileIds?: string[];
    }> = [];
    registerToolHandler("approval_test.context", async (context) => {
      receivedContexts.push({
        projectId: context.projectId,
        selectedFileIds: context.selectedFileIds,
      });
      return { saved: true };
    });
    state.executions.set(
      "execution-context",
      execution({
        id: "execution-context",
        toolId: "approval_test.context",
        riskLevel: "L2",
        args,
        contextSnapshot: {
          projectId: "project-from-proposal",
          selectedFileIds: ["file-1", "file-2"],
        },
      })
    );
    const issued = await issueApprovalToken({
      userId: "user-1",
      conversationId: "conversation-1",
      toolId: "approval_test.context",
      argumentsHash: hashArguments(args),
      requestId: "execution-context",
    });

    const response = await POST(approveRequest({
      token: issued.token,
      executionId: "execution-context",
      scope: "once",
    }));

    expect(response.status).toBe(200);
    expect(receivedContexts).toEqual([
      {
        projectId: "project-from-proposal",
        selectedFileIds: ["file-1", "file-2"],
      },
    ]);
  });
});

function execution(input: {
  id: string;
  userId?: string;
  conversationId?: string;
  toolId?: string;
  riskLevel?: string;
  args?: Record<string, unknown>;
  contextSnapshot?: { projectId?: string; selectedFileIds?: string[] };
}): ExecutionRow {
  const args = input.args ?? {};
  return {
    id: input.id,
    userId: input.userId ?? "user-1",
    conversationId: input.conversationId ?? "conversation-1",
    skillId: null,
    toolId: input.toolId ?? "project_files.delete",
    normalizedArguments: args,
    argumentsHash: hashArguments(args),
    riskLevel: input.riskLevel ?? "L3",
    status: "pending_approval",
    approvalScope: null,
    approvedAt: null,
    executedAt: null,
    completedAt: null,
    resultSummary: null,
    errorSummary: null,
    auditMetadata: input.contextSnapshot
      ? { executionContext: input.contextSnapshot }
      : null,
  };
}

function approveRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/agent/approve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
      "user-agent": "approval-route-test",
    },
    body: JSON.stringify(body),
  });
}
