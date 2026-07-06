/**
 * SkillMigration — DiscoveredSkill → SkillMetadata 转换
 *
 * 将 Agent Skills 标准格式（DiscoveredSkill + SkillPolicy）映射为
 * LumenLab 现有 SkillMetadata 接口，确保 PolicyEngine、SkillRouter、
 * Chat route 等所有消费者无需改动。
 */

import type { SkillMetadata } from "../agent/types";
import type { DiscoveredSkill, SkillPolicy } from "./discovery";

/**
 * 将 DiscoveredSkill 转换为旧的 SkillMetadata 格式。
 */
export function discoveredToMetadata(skill: DiscoveredSkill): SkillMetadata {
  const policy = skill.policy;

  return {
    skillId: skill.name,
    version: skill.version,
    description: skill.description,
    instructions: skill.instructions,
    allowedTools: policy.allowed_tools,
    allowedRiskLevel: policy.allowed_risk_level as SkillMetadata["allowedRiskLevel"],
    requiredScopes: policy.required_scopes,
    defaultApprovalPolicy: policy.default_approval_policy as SkillMetadata["defaultApprovalPolicy"],
    inputContract: policy.input_contract,
    outputContract: policy.output_contract,
    dataHandlingPolicy: {
      maySendToExternal: policy.data_handling.may_send_to_external,
      mayPersist: policy.data_handling.may_persist,
      retentionDays: policy.data_handling.retention_days,
    },
    // 扩展字段（LumenLab 特有）
    triggers: policy.triggers,
    category: skill.category,
    displayName: skill.displayName,
  } as SkillMetadata & { triggers: unknown; category: string; displayName: string };
}

/**
 * 生成默认策略 JSON 内容（用于新建 skill 时的模板）。
 */
export function generateDefaultPolicy(overrides: Partial<SkillPolicy> = {}): SkillPolicy {
  return {
    version: "1.0.0",
    category: "uncategorized",
    display_name: "",
    trust_level: "user",
    enabled: true,
    allowed_tools: [],
    allowed_risk_level: ["L1"],
    default_approval_policy: "ask_each",
    required_scopes: [],
    input_contract: {},
    output_contract: {},
    data_handling: {
      may_send_to_external: false,
      may_persist: false,
    },
    triggers: {
      include: [],
      exclude: [],
    },
    resources: {
      allow: [],
      deny: ["scripts/**"],
    },
    ...overrides,
  };
}
