import type { AgentAuditPayload } from "../audit-log";
import type {
  AgentContext,
  AgentEvent,
  ApprovalScope,
  PolicyDecision,
  SkillMetadata,
  ToolMetadata,
} from "../types";
import type { ToolExecutionPersistence } from "../persistence/tool-execution-persistence";
import type { ExecutedTool, ToolExecutionContext } from "../tool-executor";
import { toolRegistry } from "../tool-registry";
import { skillRegistry } from "../skill-registry";
import { evaluatePolicy, signAndAttachToken } from "../policy-engine";
import { executeTool } from "../tool-executor";
import { recordAuditEvent } from "../audit-log";
import { PrismaToolExecutionAdapter } from "../persistence/prisma-tool-execution-adapter";
import "@/lib/skills/registry";
import "@/lib/tools/registry";

const DEFAULT_USER_SCOPES = [
  "project.read",
  "project.write",
  "artifact.read",
  "artifact.write",
];

export interface ToolInvocationRequest {
  call: {
    id: string;
    toolId: string;
    arguments: Record<string, unknown>;
  };
  context: {
    userId: string;
    conversationId: string;
    projectId?: string;
    selectedFileIds?: string[];
    skillId?: string;
    signal?: AbortSignal;
    sessionApprovals: Map<string, ApprovalScope>;
  };
}

export type ToolRunResult =
  | {
      status: "succeeded";
      executionId: string;
      summary: Record<string, unknown>;
    }
  | { status: "failed"; executionId: string; code: string; error: string }
  | { status: "blocked"; executionId: string; code: string; error: string }
  | { status: "pending_approval"; executionId: string };

interface IssuedApproval {
  token: string;
  expiresAt: Date;
}

export interface ToolRunnerDependencies {
  resolveTool(toolId: string): ToolMetadata | undefined;
  resolveSkill(skillId: string): SkillMetadata | undefined;
  evaluatePolicy(context: AgentContext): Promise<PolicyDecision>;
  issueApproval(input: {
    userId: string;
    conversationId: string;
    toolId: string;
    arguments: Record<string, unknown>;
    requestId: string;
  }): Promise<IssuedApproval>;
  persistence: ToolExecutionPersistence;
  execute(
    toolId: string,
    context: ToolExecutionContext,
    args: Record<string, unknown>
  ): Promise<ExecutedTool>;
  audit(event: AgentAuditPayload): Promise<void>;
}

export interface ToolRunner {
  run(
    request: ToolInvocationRequest,
    emit: (event: AgentEvent) => void
  ): Promise<ToolRunResult>;
}

export function createToolRunner(dependencies: ToolRunnerDependencies): ToolRunner {
  return {
    async run(request, emit) {
      const tool = dependencies.resolveTool(request.call.toolId);
      if (!tool) {
        const error = `未注册工具: ${request.call.toolId}`;
        emit({
          type: "tool_failed",
          executionId: request.call.id,
          errorCode: "TOOL_NOT_REGISTERED",
          error,
        });
        return {
          status: "failed",
          executionId: request.call.id,
          code: "TOOL_NOT_REGISTERED",
          error,
        };
      }

      const skill = request.context.skillId
        ? dependencies.resolveSkill(request.context.skillId)
        : undefined;
      const policyContext = buildAgentContext(request, tool, skill);
      const decision = await dependencies.evaluatePolicy(policyContext);
      const execution = await dependencies.persistence.propose({
        userId: request.context.userId,
        conversationId: request.context.conversationId,
        skillId: request.context.skillId,
        skillVersion: skill?.version,
        tool,
        arguments: request.call.arguments,
        riskLevel: tool.riskLevel,
        contextSnapshot: {
          ...(request.context.projectId
            ? { projectId: request.context.projectId }
            : {}),
          ...(request.context.selectedFileIds
            ? { selectedFileIds: [...request.context.selectedFileIds] }
            : {}),
        },
      });
      await audit(dependencies, request, execution.id, "tool_proposed", "info", {
        riskLevel: tool.riskLevel,
      });
      emit({
        type: "tool_proposed",
        executionId: execution.id,
        preview: decision.sanitizedPreview,
      });

      if (decision.decision === "deny") {
        const error = {
          code: decision.reasonCode,
          message: decision.sanitizedPreview.summary,
        };
        await dependencies.persistence.markBlocked(execution.id, error);
        await audit(dependencies, request, execution.id, "tool_blocked", "warn", error);
        emit({
          type: "tool_blocked",
          executionId: execution.id,
          reasonCode: error.code,
          reason: error.message,
        });
        return {
          status: "blocked",
          executionId: execution.id,
          code: error.code,
          error: error.message,
        };
      }

      if (request.context.signal?.aborted) {
        return failAborted(dependencies, request, execution.id, emit);
      }

      if (decision.decision === "require_approval") {
        const approval = await dependencies.issueApproval({
          userId: request.context.userId,
          conversationId: request.context.conversationId,
          toolId: tool.toolId,
          arguments: request.call.arguments,
          requestId: execution.id,
        });
        await dependencies.persistence.markPendingApproval(execution.id, {
          expiresAt: approval.expiresAt,
          approvalSnapshot: decision,
        });
        await audit(
          dependencies,
          request,
          execution.id,
          "approval_required",
          "info",
          { expiresAt: approval.expiresAt.toISOString() }
        );
        emit({
          type: "approval_required",
          executionId: execution.id,
          preview: decision.sanitizedPreview,
          token: approval.token,
          expiresAt: approval.expiresAt.getTime(),
          canApproveSession:
            decision.riskLevel === "L1" || decision.riskLevel === "L2",
        });
        return { status: "pending_approval", executionId: execution.id };
      }

      await dependencies.persistence.markExecuting(execution.id);
      await audit(dependencies, request, execution.id, "tool_started", "info", {});
      emit({ type: "tool_started", executionId: execution.id });
      if (request.context.signal?.aborted) {
        return failAborted(dependencies, request, execution.id, emit);
      }
      const executed = await dependencies.execute(
        tool.toolId,
        {
          userId: request.context.userId,
          conversationId: request.context.conversationId,
          projectId: request.context.projectId,
          selectedFileIds: request.context.selectedFileIds,
          ...(request.context.signal ? { signal: request.context.signal } : {}),
        },
        request.call.arguments
      );

      if (!executed.ok) {
        const error = {
          code: executed.errorCode ?? "HANDLER_ERROR",
          message: executed.errorMessage ?? "工具执行失败",
        };
        await dependencies.persistence.markFailed(execution.id, error);
        await audit(dependencies, request, execution.id, "tool_failed", "error", error);
        emit({
          type: "tool_failed",
          executionId: execution.id,
          errorCode: error.code,
          error: error.message,
        });
        return {
          status: "failed",
          executionId: execution.id,
          code: error.code,
          error: error.message,
        };
      }

      const summary = executed.result ?? {};
      await dependencies.persistence.markSucceeded(execution.id, summary);
      await audit(dependencies, request, execution.id, "tool_completed", "info", {
        resultSummary: summary,
      });
      emit({ type: "tool_completed", executionId: execution.id, resultSummary: summary });
      return { status: "succeeded", executionId: execution.id, summary };
    },
  };
}

async function failAborted(
  dependencies: ToolRunnerDependencies,
  request: ToolInvocationRequest,
  executionId: string,
  emit: (event: AgentEvent) => void
): Promise<ToolRunResult> {
  const error = {
    code: "REQUEST_ABORTED",
    message: "请求已取消，工具未执行",
  };
  await dependencies.persistence.markFailed(executionId, error);
  await audit(
    dependencies,
    request,
    executionId,
    "tool_failed",
    "warn",
    error
  );
  emit({
    type: "tool_failed",
    executionId,
    errorCode: error.code,
    error: error.message,
  });
  return {
    status: "failed",
    executionId,
    code: error.code,
    error: error.message,
  };
}

export function createPrismaToolRunner(): ToolRunner {
  return createToolRunner({
    resolveTool: (toolId) => toolRegistry.get(toolId),
    resolveSkill: (skillId) => skillRegistry.get(skillId),
    evaluatePolicy,
    issueApproval: signAndAttachToken,
    persistence: new PrismaToolExecutionAdapter(),
    execute: executeTool,
    audit: recordAuditEvent,
  });
}

function buildAgentContext(
  request: ToolInvocationRequest,
  tool: ToolMetadata,
  skill: SkillMetadata | undefined
): AgentContext {
  return {
    user: { id: request.context.userId, scopes: DEFAULT_USER_SCOPES },
    workspace: { id: request.context.projectId ?? "default", policies: [] },
    conversation: {
      id: request.context.conversationId,
      activeSkill:
        request.context.skillId && skill
          ? { skillId: request.context.skillId, version: skill.version }
          : undefined,
      sessionApprovals: request.context.sessionApprovals,
    },
    skill,
    tool,
    arguments: request.call.arguments,
    resourceContext: {
      projectId: request.context.projectId,
      selectedFileIds: request.context.selectedFileIds,
    },
  };
}

function audit(
  dependencies: ToolRunnerDependencies,
  request: ToolInvocationRequest,
  executionId: string,
  eventType: AgentAuditPayload["eventType"],
  severity: AgentAuditPayload["severity"],
  payload: Record<string, unknown>
) {
  return dependencies.audit({
    userId: request.context.userId,
    conversationId: request.context.conversationId,
    toolExecutionId: executionId,
    skillId: request.context.skillId,
    toolId: request.call.toolId,
    eventType,
    severity,
    payload,
  });
}
