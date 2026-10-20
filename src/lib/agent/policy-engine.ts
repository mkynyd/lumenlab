/**
 * Policy Engine — 服务端独立决策
 *
 * 工具在通过权限、资源归属、参数和显式禁用检查后自动执行。
 * 风险等级保留用于审计和 Skill 能力边界，不再触发人工审批。
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

const USER_PREFERENCE_CACHE_TTL_MS = 60_000;

interface UserPrefCacheEntry {
  value: UserPrefRow | null;
  expiresAt: number;
}

const userPreferenceCache = new Map<string, UserPrefCacheEntry>();

async function loadUserPreference(
  userId: string,
  toolId: string
): Promise<UserPrefRow | null> {
  const key = `${userId}::${toolId}`;
  const now = Date.now();
  const cached = userPreferenceCache.get(key);
  // 短 TTL 缓存:用户改审批模式后最多 60 秒生效,无需重启进程。
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const row = await prisma.userToolPreference.findUnique({
      where: { userId_toolId: { userId, toolId } },
    });
    const value = row ? ({ approvalMode: row.approvalMode as ApprovalMode } as UserPrefRow) : null;
    userPreferenceCache.set(key, {
      value,
      expiresAt: now + USER_PREFERENCE_CACHE_TTL_MS,
    });
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
  const { user, workspace, skill, tool, arguments: args } = ctx;
  void options; // Retained for compatibility with legacy approval callers.
  // The runtime exposes enabled web tools independently of a Skill's tools.
  // Apply their own scope/risk/approval policy; workspace and user restrictions
  // still apply below. This flag is supplied by the server, never tool arguments.
  const independentWebTool = ctx.webSearchActive === true &&
    (tool.toolId === "web.search" || tool.toolId === "web.fetch");
  const policySkill = independentWebTool ? undefined : skill;

  // 1. Tool 注册
  if (!toolRegistry.has(tool.toolId)) {
    return denyDecision(tool, "TOOL_NOT_REGISTERED", "Tool 未注册");
  }

  const toolRisk = RISK_RANK[tool.riskLevel];

  // 2. user scope 检查
  const requiredScopes = new Set<string>(tool.requiredScopes);
  if (policySkill) for (const s of policySkill.requiredScopes) requiredScopes.add(s);
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
  // skill.activate 是全局 Skill 切换能力，runtime 始终将其暴露给模型，
  // 不应被单个 Skill 的 allowedTools 限制（否则模型按系统提示切换 Skill 时会被拒绝）。
  if (policySkill && !isRuntimeMetaTool(tool.toolId)) {
    if (!policySkill.allowedTools.includes(tool.toolId)) {
      return denyDecision(
        tool,
        "TOOL_NOT_IN_SKILL_ALLOWLIST",
        `Skill ${policySkill.skillId} 不允许调用 ${tool.toolId}`,
        skill
      );
    }
    const skillMaxRisk = Math.max(...policySkill.allowedRiskLevel.map((r) => RISK_RANK[r]));
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

  // Existing explicit blocks remain restrictions; legacy ask_* modes no longer
  // interrupt a task. All allowed risk levels execute through the same runner.
  const userPref = await loadUserPreference(user.id, tool.toolId);
  if (userPref?.approvalMode === "block") {
    return denyDecision(tool, "USER_BLOCKED", "用户已禁用此工具", skill);
  }
  if (tool.defaultApprovalMode === "block" || policySkill?.defaultApprovalPolicy === "block") {
    return denyDecision(tool, "POLICY_BLOCKED", "策略已禁用此工具", skill);
  }
  return {
    decision: "allow",
    reasonCode: "AUTO_APPROVED_BY_POLICY",
    riskLevel: tool.riskLevel,
    approvalRequired: false,
    sanitizedPreview: buildPreview(tool, args, ctx),
    auditRequirements: tool.auditLevel,
  };
}

function isRuntimeMetaTool(toolId: string) {
  return toolId === "skill.activate" || toolId === "plan.update";
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
