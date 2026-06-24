/**
 * 内置 Skill 注册
 *
 * 副作用导入：import "@/lib/skills/registry"; 即可注册全部 Skill。
 */

import { skillRegistry } from "../agent/skill-registry";
import { PAPER_WRITER_SKILL } from "./paper-writer/manifest";
import { EXAM_COACH_SKILL } from "./exam-coach/manifest";
import { CODE_READER_SKILL } from "./code-reader/manifest";
import { PAPER_READER_SKILL } from "./paper-reader/manifest";
import { EXAM_EXTRACT_SKILL } from "./exam-extract/manifest";
import { SOCRATIC_TUTOR_SKILL } from "./socratic-tutor/manifest";

let registered = false;

export function registerBuiltinSkills(): void {
  if (registered) return;
  registered = true;
  skillRegistry.register(PAPER_WRITER_SKILL);
  skillRegistry.register(EXAM_COACH_SKILL);
  skillRegistry.register(CODE_READER_SKILL);
  skillRegistry.register(PAPER_READER_SKILL);
  skillRegistry.register(EXAM_EXTRACT_SKILL);
  skillRegistry.register(SOCRATIC_TUTOR_SKILL);
}

export {
  PAPER_WRITER_SKILL,
  EXAM_COACH_SKILL,
  CODE_READER_SKILL,
  PAPER_READER_SKILL,
  EXAM_EXTRACT_SKILL,
  SOCRATIC_TUTOR_SKILL,
};

/**
 * 旧 skills 模块兼容：保留 SkillDefinition / getSkillSet / buildToolsPayload。
 *
 * 真实的新调用应该走 agent/skill-registry；这里只为不让旧 chat/route.ts 立刻崩。
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

export function getSkillSet(_mode?: string): SkillDefinition[] {
  return [
    SKILL_WEB_SEARCH,
    SKILL_SEARCH_PROJECT_FILES,
    SKILL_LIST_PROJECT_FILES,
  ];
}

/**
 * Provider-aware tools payload
 *
 * DeepSeek anthropic-compat 只支持 server 端 web_search；客户端工具不应发送，
 * 否则 DeepSeek 会以 400 拒绝（unknown variant `custom`）。
 */
export const DEEPSEEK_WEB_SEARCH_TYPE = "web_search_20250305";

export function buildToolsPayloadForProvider(
  skills: SkillDefinition[],
  provider: "deepseek" | "minimax"
): Array<{ type: string; name?: string }> | undefined {
  if (provider === "minimax") return undefined;
  const serverSkills = skills.filter((s) => s.type === "server");
  if (serverSkills.length === 0) return undefined;
  return serverSkills.map((s) => ({
    type: s.name === "web_search" ? DEEPSEEK_WEB_SEARCH_TYPE : s.name,
    name: "web_search",
  }));
}

registerBuiltinSkills();