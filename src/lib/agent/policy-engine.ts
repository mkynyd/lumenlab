/**
 * Policy Engine — 服务端独立决策
 *
 * 风险等级是 Tool 元数据静态定义的；Skill 不能放宽，只能叠加更严的策略；
 * 用户偏好可以更严，但 L3/L4 永远强制 ask_each，不能被永久 auto 覆盖。
 */

import {
  hashArguments,
  issueApprovalToken,
  type IssuedToken,
} from "./approval-token";
import { buildPreview } from "./preview-builder";
import { toolRegistry } from "./tool-registry";
import type {
  AgentContext,
  ApprovalMode,
  PolicyDecision,
  RiskLevel,
  SkillMetadata,
  ToolMetadata,
} from "./types";
import { prisma } from "@/lib/db";
import { assertProjectOwned, assertFileOwned } from "@/lib/tools/shared/sanitize";

const RISK_RANK: Record<RiskLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

const STRICTNESS_RANK: Record<ApprovalMode, number> = {
  auto: 0,
  ask_first: 1,
  ask_each: 2,
  block: 3,
};

function maxStrictness(a: ApprovalMode, b: ApprovalMode): ApprovalMode {
  return STRICTNESS_RANK[a] >= STRICTNESS_RANK[b] ? a : b;
}

/**
 * 检查用户是否拥有参数引用的资源（按 projectId/ownerId 跨租户检查）
 */
async function checkResourceOwnership(
  args: Record<string, unknown>,
  ctx: AgentContext
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const projectId =
      (args.projectId as string | undefined) ?? ctx.resourceContext.projectId;
    if (projectId) {
      await assertProjectOwned(ctx.user.id, projectId);
    }

    const fileId = args.fileId as string | undefined;
    if (fileId) {
      await assertFileOwned(ctx.user.id, fileId, projectId);
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "资源归属校验失败",
    };
  }
}

/**
 * 极简 JSON Schema 子集校验：要求必填字段存在，类型匹配
 */
function validateArgs(
  schema: Record<string, unknown>,
  args: Record<string, unknown>
): boolean {
  if (schema.type !== "object") return true;
  const required = (schema.required as string[] | undefined) ?? [];
  for (const key of required) {
    if (!(key in args)) return false;
  }
  const properties = (schema.properties as Record<string, { type?: string }> | undefined) ?? {};
  for (const [key, def] of Object.entries(properties)) {
    if (!(key in args) || args[key] === undefined) continue;
    const actual = args[key];
    if (def.type === "string" && typeof actual !== "string") return false;
    if (def.type === "number" && typeof actual !== "number") return false;
    if (def.type === "integer" && typeof actual !== "number") return false;
    if (def.type === "boolean" && typeof actual !== "boolean") return false;
    if (def.type === "array" && !Array.isArray(actual)) return false;
    if (def.type === "object" && (typeof actual !== "object" || actual === null || Array.isArray(actual))) {
      return false;
    }
  }
  return true;
}

interface UserPrefRow {
  approvalMode: ApprovalMode;
}

const userPreferenceCache = new Map<string, UserPrefRow | null>();

async function loadUserPreference(
  userId: string,
  toolId: string
): Promise<UserPrefRow | null> {
  const key = `${userId}::${toolId}`;
  if (userPreferenceCache.has(key)) return userPreferenceCache.get(key) ?? null;
  try {
    const row = await prisma.userToolPreference.findUnique({
      where: { userId_toolId: { userId, toolId } },
    });
    const value = row ? ({ approvalMode: row.approvalMode as ApprovalMode } as UserPrefRow) : null;
    userPreferenceCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function __clearUserPreferenceCacheForTesting(): void {
  userPreferenceCache.clear();
}

/**
 * MVP 入口：纯函数 + 异步 token 签发
 */
export async function evaluatePolicy(
  ctx: AgentContext,
  options?: {
    /** 用户已批准的 toolCall，避免重复 token 签发 */
    preApprovedToken?: { token: string; expiresAt: Date; executionId: string };
    /** 是否允许此次会话级 pre-approval（L1/L2 才用得到） */
    recordSessionApproval?: (toolId: string, scope: "session") => void;
  }
): Promise<PolicyDecision> {
  const { user, workspace, conversation, skill, tool, arguments: args } = ctx;

  // 1. Tool 注册
  if (!toolRegistry.has(tool.toolId)) {
    return denyDecision(tool, "TOOL_NOT_REGISTERED", "Tool 未注册");
  }

  const toolRisk = RISK_RANK[tool.riskLevel];

  // 2. user scope 检查
  const requiredScopes = new Set<string>(tool.requiredScopes);
  if (skill) for (const s of skill.requiredScopes) requiredScopes.add(s);
  for (const scope of requiredScopes) {
    if (!user.scopes.includes(scope)) {
      return denyDecision(
        tool,
        "SCOPE_NOT_GRANTED",
        `缺少权限: ${scope}`,
        skill
      );
    }
  }

  // 3. workspace policy
  const workspacePolicy = workspace.policies.find(
    (p) => p.toolId === tool.toolId || (skill && p.skillId === skill.skillId)
  );
  if (workspacePolicy?.mode === "block") {
    return denyDecision(
      tool,
      "WORKSPACE_BLOCKED",
      workspacePolicy.reason ?? "Workspace 已禁用",
      skill
    );
  }

  // 4. Skill allowlist
  if (skill) {
    if (!skill.allowedTools.includes(tool.toolId)) {
      return denyDecision(
        tool,
        "TOOL_NOT_IN_SKILL_ALLOWLIST",
        `Skill ${skill.skillId} 不允许调用 ${tool.toolId}`,
        skill
      );
    }
    const skillMaxRisk = Math.max(...skill.allowedRiskLevel.map((r) => RISK_RANK[r]));
    if (toolRisk > skillMaxRisk) {
      return denyDecision(
        tool,
        "TOOL_RISK_EXCEEDS_SKILL_CEILING",
        `Tool 风险 ${tool.riskLevel} 超出 Skill 上限`,
        skill
      );
    }
  }

  // 5. 跨租户
  const ownership = await checkResourceOwnership(args, ctx);
  if (!ownership.ok) {
    return denyDecision(tool, "CROSS_TENANT_ACCESS", ownership.reason, skill);
  }

  // 6. 参数校验
  if (!validateArgs(tool.inputSchema, args)) {
    return denyDecision(tool, "INVALID_ARGUMENTS", "参数不合法", skill);
  }

  // 7. 决定审批模式
  let approvalMode: ApprovalMode = tool.defaultApprovalMode;
  if (skill) {
    approvalMode = maxStrictness(approvalMode, skill.defaultApprovalPolicy);
  }
  const userPref = await loadUserPreference(user.id, tool.toolId);
  if (userPref) {
    if (toolRisk >= 3 && userPref.approvalMode === "auto") {
      approvalMode = "ask_each";
    } else {
      approvalMode = maxStrictness(approvalMode, userPref.approvalMode);
    }
  }
  if (toolRisk >= 3) {
    approvalMode = "ask_each";
  }

  // 8. 会话级 pre-approval
  if (toolRisk <= 2) {
    const sessionApproved = conversation.sessionApprovals.get(tool.toolId);
    if (sessionApproved === "session") {
      return {
        decision: "allow",
        reasonCode: "SESSION_PRE_APPROVED",
        riskLevel: tool.riskLevel,
        approvalRequired: false,
        sanitizedPreview: buildPreview(tool, args, ctx),
        auditRequirements: tool.auditLevel,
      };
    }
  }

  // 9. auto + 无需审批
  if (toolRisk <= 2 && approvalMode === "auto") {
    return {
      decision: "allow",
      reasonCode: "AUTO_APPROVED_BY_POLICY",
      riskLevel: tool.riskLevel,
      approvalRequired: false,
      sanitizedPreview: buildPreview(tool, args, ctx),
      auditRequirements: tool.auditLevel,
    };
  }

  // 10. 需要审批：发一次性 token
  if (options?.preApprovedToken) {
    return {
      decision: "require_approval",
      reasonCode:
        approvalMode === "ask_first"
          ? "FIRST_TIME_USE_REQUIRES_APPROVAL"
          : "POLICY_REQUIRES_APPROVAL",
      riskLevel: tool.riskLevel,
      approvalRequired: true,
      approvalScope: "once",
      sanitizedPreview: buildPreview(tool, args, ctx),
      auditRequirements: tool.auditLevel,
      approvalToken: options.preApprovedToken,
    };
  }

  // 由调用方负责先把 ToolExecution 行写入并传 executionId；本函数不知道执行 ID。
  // 约定：调用方在拿到 decision 后再决定要不要走 token 签发路径（approval_required）。
  // 这里直接返回 require_approval 但不带 token；signAndAttachToken 是另一个独立步骤。
  return {
    decision: "require_approval",
    reasonCode:
      approvalMode === "ask_first"
        ? "FIRST_TIME_USE_REQUIRES_APPROVAL"
        : "POLICY_REQUIRES_APPROVAL",
    riskLevel: tool.riskLevel,
    approvalRequired: true,
    approvalScope: "once",
    sanitizedPreview: buildPreview(tool, args, ctx),
    auditRequirements: tool.auditLevel,
  };
}

function denyDecision(
  tool: ToolMetadata,
  reasonCode: string,
  reason: string,
  skill?: SkillMetadata
): PolicyDecision {
  return {
    decision: "deny",
    reasonCode,
    riskLevel: tool.riskLevel,
    approvalRequired: false,
    sanitizedPreview: {
      toolId: tool.toolId,
      toolName: tool.name,
      summary: `拒绝：${reason}`,
      affectedResources: [],
      sendsToExternal: false,
      isReversible: false,
      dataTypes: [],
      skillName: skill?.skillId,
    },
    auditRequirements: tool.auditLevel,
  };
}

/**
 * 在 decide 后由调用方签发一次性 token，绑到 ToolExecution 行
 */
export async function signAndAttachToken(params: {
  userId: string;
  conversationId: string;
  toolId: string;
  arguments: Record<string, unknown>;
  requestId: string;
}): Promise<IssuedToken> {
  const argumentsHash = hashArguments(params.arguments);
  return issueApprovalToken({
    userId: params.userId,
    conversationId: params.conversationId,
    toolId: params.toolId,
    argumentsHash,
    requestId: params.requestId,
  });
}