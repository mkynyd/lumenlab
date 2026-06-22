/**
 * Skills Registry — 定义所有可用工具及其 JSON Schema。
 *
 * 技能分为两类：
 *   1. server-side — DeepSeek 服务端托管执行（如 web_search）
 *   2. client-side — 由应用代码执行并返回 tool_result（如 search_project_files）
 */

export interface SkillDefinition {
  name: string;
  description: string;
  type: "server" | "client";
  inputSchema: Record<string, unknown>;
  /** Only for client-side skills: the function to execute */
  execute?: (input: Record<string, unknown>, context: SkillContext) => Promise<string>;
}

export interface SkillContext {
  userId: string;
  projectId?: string;
  conversationId?: string;
}

// ============================================================
// Skill Definitions
// ============================================================

export const SKILL_WEB_SEARCH: SkillDefinition = {
  name: "web_search",
  description: "Search the web for current information. Use this when the user asks about recent events, current data, or information not in the training data.",
  type: "server",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export const SKILL_SEARCH_PROJECT_FILES: SkillDefinition = {
  name: "search_project_files",
  description: "Search within the user's uploaded project files for relevant content. Use this when the user asks about information that may be in their uploaded course materials, notes, or documents.",
  type: "client",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to find in project files. Use keywords from the user's question.",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return (default: 5, max: 10)",
        default: 5,
      },
    },
    required: ["query"],
  },
  execute: undefined, // Set at runtime
};

export const SKILL_LIST_PROJECT_FILES: SkillDefinition = {
  name: "list_project_files",
  description: "List all files in the current project. Use this when the user asks what files are available or wants to know what materials they have uploaded.",
  type: "client",
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: undefined, // Set at runtime
};

export const SKILL_READ_FILE_CONTENT: SkillDefinition = {
  name: "read_file_content",
  description: "Read the full text content of a specific uploaded file in the project. Use this when the user asks about a specific file or wants to see its contents.",
  type: "client",
  inputSchema: {
    type: "object",
    properties: {
      fileId: {
        type: "string",
        description: "The ID of the file to read. Get this from list_project_files first.",
      },
    },
    required: ["fileId"],
  },
  execute: undefined, // Set at runtime
};

// ============================================================
// Skill Sets — 按场景组合技能
// ============================================================

export interface SkillSet {
  mode: string;
  skills: SkillDefinition[];
}

export function getSkillSet(mode?: string): SkillDefinition[] {
  if (!mode) return DEFAULT_SKILLS;

  switch (mode) {
    case "review":
      return [...DEFAULT_SKILLS, SKILL_SEARCH_PROJECT_FILES, SKILL_LIST_PROJECT_FILES, SKILL_READ_FILE_CONTENT];
    case "experiment":
      return [...DEFAULT_SKILLS, SKILL_SEARCH_PROJECT_FILES, SKILL_LIST_PROJECT_FILES, SKILL_READ_FILE_CONTENT];
    case "coding":
      return [...DEFAULT_SKILLS, SKILL_SEARCH_PROJECT_FILES, SKILL_READ_FILE_CONTENT];
    default:
      return DEFAULT_SKILLS;
  }
}

const DEFAULT_SKILLS: SkillDefinition[] = [
  SKILL_WEB_SEARCH,
];

// ============================================================
// Helpers
// ============================================================

export function isServerSideSkill(name: string): boolean {
  return name === "web_search";
}

export function getClientSkills(skills: SkillDefinition[]): SkillDefinition[] {
  return skills.filter((s) => s.type === "client");
}

export function getServerSkills(skills: SkillDefinition[]): SkillDefinition[] {
  return skills.filter((s) => s.type === "server");
}

export function buildToolsPayload(skills: SkillDefinition[]): Array<{ type: string; name?: string; description?: string; input_schema?: Record<string, unknown> }> {
  return skills.map((s) => {
    if (s.type === "server") {
      return { type: s.name };
    }
    return {
      type: "custom",
      name: s.name,
      description: s.description,
      input_schema: s.inputSchema,
    };
  });
}
