/**
 * 内置 Skill 注册
 *
 * 从 .agents/skills/ 目录 discovery 加载（Agent Skills 标准兼容）。
 * 副作用导入：import "@/lib/skills/registry"; 即可注册全部 Skill。
 */

import { skillRegistry } from "../agent/skill-registry";

let registered = false;

/**
 * 从 discovery 注册 skill（异步，应在服务启动时调用）。
 * 也作为 registerBuiltinSkills 的 fallback：当 discovery 尚未执行时，
 * 先触发同步注册占位，等待后续 discovery 刷新。
 */
export async function registerFromDiscovery(): Promise<number> {
  const { discoverAll } = await import("./discovery");
  const { discoveredToMetadata } = await import("./migration");
  const path = await import("path");

  const baseDir = path.join(process.cwd(), ".agents/skills");

  try {
    const result = await discoverAll(baseDir);

    for (const err of result.errors) {
      console.error(`[SkillRegistry] Discovery error [${err.skill}]: ${err.message}`);
    }
    for (const warn of result.warnings) {
      console.warn(`[SkillRegistry] Discovery warning [${warn.skill}]: ${warn.message}`);
    }

    // 清空旧注册，以 discovery 为准
    skillRegistry.reset();

    for (const skill of result.skills) {
      const metadata = discoveredToMetadata(skill);
      skillRegistry.register(metadata);
    }

    console.log(
      `[SkillRegistry] Registered ${result.skills.length} skills from discovery ` +
      `(${result.catalog.length} categories)`,
    );

    registered = true;
    return result.skills.length;
  } catch (err) {
    console.error("[SkillRegistry] Discovery failed:", err);
    return 0;
  }
}

/**
 * 同步注册入口（模块加载时调用）。
 * 当 discovery 尚未执行时，无 skill 注册。
 * 真正的注册由 registerFromDiscovery() 在运行时完成。
 */
export function registerBuiltinSkills(): void {
  if (registered) return;
  registered = true;
  // discovery 将在首次 API 调用或启动时通过 registerFromDiscovery() 完成
}

/**
 * 旧 skills 模块兼容：保留 SkillDefinition / getSkillSet / buildToolsPayload。
 */

export interface SkillDefinition {
  name: string;
  description: string;
  type: "server" | "client";
  inputSchema: Record<string, unknown>;
}

export const SKILL_WEB_SEARCH: SkillDefinition = {
  name: "web_search",
  description: "Search the web for current information.",
  type: "server",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export const SKILL_SEARCH_PROJECT_FILES: SkillDefinition = {
  name: "search_project_files",
  description: "Search within uploaded project files.",
  type: "client",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      maxResults: { type: "number", description: "Max results", default: 5 },
    },
    required: ["query"],
  },
};

export const SKILL_LIST_PROJECT_FILES: SkillDefinition = {
  name: "list_project_files",
  description: "List all files in the current project.",
  type: "client",
  inputSchema: { type: "object", properties: {} },
};

export function getSkillSet(mode?: string): SkillDefinition[] {
  void mode;
  return [
    SKILL_WEB_SEARCH,
    SKILL_SEARCH_PROJECT_FILES,
    SKILL_LIST_PROJECT_FILES,
  ];
}

export const DEEPSEEK_WEB_SEARCH_TYPE = "web_search_20250305";

export function buildToolsPayloadForProvider(
  skills: SkillDefinition[],
  provider: "deepseek" | "minimax",
): Array<{ type: string; name?: string }> | undefined {
  if (provider === "minimax") return undefined;
  const serverSkills = skills.filter((s) => s.type === "server");
  if (serverSkills.length === 0) return undefined;
  return serverSkills.map((s) => ({
    type: s.name === "web_search" ? DEEPSEEK_WEB_SEARCH_TYPE : s.name,
    name: "web_search",
  }));
}

// 模块副作用
registerBuiltinSkills();
