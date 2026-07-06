/**
 * activate_skill tool handler
 *
 * 当模型调用 activate_skill(name) 时，从 skillRegistry 获取完整 instructions
 * 并以 structured wrapping 格式返回，遵循 Agent Skills 规范的渐进披露 Tier 2。
 */

import { skillRegistry } from "./skill-registry";

export interface ActivateSkillResult {
  skill_name: string;
  version: string;
  category: string;
  content: string;
  resources: Array<{ path: string; description: string }>;
  base_directory: string;
  policy_summary: {
    allowed_tools: string[];
    risk_ceiling: string;
    approval: string;
    may_send_to_external: boolean;
  };
}

/**
 * 激活指定 skill，返回结构化内容。
 * 如果 skill 不存在，返回错误信息。
 */
export function activateSkill(name: string): ActivateSkillResult | { error: string } {
  const skill = skillRegistry.get(name);
  if (!skill) {
    const available = skillRegistry.list().map((s) => s.skillId).join(", ");
    return {
      error: `Unknown skill "${name}". Available skills: ${available}`,
    };
  }

  const content = `<skill_content name="${skill.skillId}">\n${skill.instructions}\n</skill_content>`;

  // 构建资源列表（Phase 1 内置 skill 资源自包含，返回空列表）
  const resources: Array<{ path: string; description: string }> = [];
  // Phase 2: 扫描 skill 目录下 references/ 和 assets/ 的实际文件

  return {
    skill_name: skill.skillId,
    version: skill.version,
    category: skill.category || "uncategorized",
    content,
    resources,
    base_directory: skill.category
      ? `.agents/skills/${skill.category}/${skill.skillId}/`
      : "",
    policy_summary: {
      allowed_tools: skill.allowedTools,
      risk_ceiling: maxRiskLevel(skill.allowedRiskLevel),
      approval: skill.defaultApprovalPolicy,
      may_send_to_external: skill.dataHandlingPolicy?.maySendToExternal ?? false,
    },
  };
}

/**
 * 构建 activate_skill tool 的 inputSchema enum（所有已注册 skill 的 ID 列表）。
 * 约束模型的 name 参数只能选择真实存在的 skill。
 */
export function buildActivateSkillEnum(): string[] {
  return skillRegistry.list().map((s) => s.skillId);
}

function maxRiskLevel(levels: string[]): string {
  if (!levels || levels.length === 0) return "L1";
  const rank: Record<string, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
  let max = "L1";
  let maxR = 1;
  for (const l of levels) {
    const r = rank[l] ?? 0;
    if (r > maxR) { maxR = r; max = l; }
  }
  return max;
}
