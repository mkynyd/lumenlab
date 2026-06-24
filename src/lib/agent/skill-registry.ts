/**
 * Skill 中央注册表
 *
 * Skill 是受控的能力包：包含 instructions、Tool allowlist、风险上限和默认审批策略。
 * Skill 不能放宽任何 Tool 的风险等级，只能在此基础上叠加更严格的策略。
 */

import type { SkillMetadata } from "./types";

class SkillRegistry {
  private readonly skills = new Map<string, SkillMetadata>();

  register(metadata: SkillMetadata): void {
    this.skills.set(metadata.skillId, metadata);
  }

  get(skillId: string): SkillMetadata | undefined {
    return this.skills.get(skillId);
  }

  require(skillId: string): SkillMetadata {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not registered: ${skillId}`);
    return skill;
  }

  list(): SkillMetadata[] {
    return [...this.skills.values()];
  }

  reset(): void {
    this.skills.clear();
  }
}

export const skillRegistry = new SkillRegistry();