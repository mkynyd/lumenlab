/**
 * SkillDiscovery — Agent Skills 标准兼容的 skill 发现与解析模块
 *
 * 负责：
 * 1. 扫描 .agents/skills/ 目录树，发现所有 SKILL.md
 * 2. 解析 YAML frontmatter（name, description）
 * 3. 加载同目录下的 policy.json
 * 4. 校验 skill 完整性
 * 5. 解析 INDEX.md 构建分类 catalog
 */

import * as fs from "fs";
import * as path from "path";

// ─── 类型定义 ───────────────────────────────────────────────

export interface SkillPolicy {
  version: string;
  category: string;
  display_name: string;
  trust_level: "builtin" | "user" | "project";
  enabled: boolean;
  allowed_tools: string[];
  allowed_risk_level: string[];
  default_approval_policy: string;
  required_scopes: string[];
  input_contract: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  data_handling: {
    may_send_to_external: boolean;
    may_persist: boolean;
    retention_days?: number;
  };
  triggers: {
    include: string[];
    exclude: string[];
  };
  resources: {
    allow: string[];
    deny: string[];
  };
}

export interface DiscoveredSkill {
  name: string;
  description: string;
  version: string;
  category: string;
  displayName: string;
  instructions: string;
  /** SKILL.md 绝对路径 */
  location: string;
  /** skill 目录绝对路径 */
  baseDirectory: string;
  policy: SkillPolicy;
  source: "builtin" | "user" | "project";
}

export interface SkillCatalogCategory {
  slug: string;
  displayName: string;
  skills: CatalogSkillEntry[];
}

export interface CatalogSkillEntry {
  name: string;
  displayName: string;
  description: string;
  version: string;
  source: string;
  riskSummary: {
    ceiling: string;
    approval: string;
    external: boolean;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── 默认策略（policy.json 缺失时使用：最严格） ─────────────

const DEFAULT_POLICY: SkillPolicy = {
  version: "0.0.0",
  category: "uncategorized",
  display_name: "",
  trust_level: "builtin",
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
  triggers: { include: [], exclude: [] },
  resources: { allow: [], deny: ["scripts/**", "**/*"] },
};

// ─── 最小 YAML frontmatter 解析器 ──────────────────────────

interface ParsedFrontmatter {
  name: string;
  description: string;
  /** frontmatter 以外的自定义字段，原样保留 */
  extra: Record<string, string>;
}

interface ParsedSkillMD {
  frontmatter: ParsedFrontmatter;
  body: string;
}

/**
 * 解析 SKILL.md 文件内容。
 * 仅提取 name 和 description（标准必需字段），其余 YAML 字段放入 extra。
 */
export function parseSkillMarkdown(content: string): ParsedSkillMD | null {
  const trimmed = content.trimStart();

  // 必须以 --- 开头
  if (!trimmed.startsWith("---")) {
    return null;
  }

  const endOfFirstLine = trimmed.indexOf("\n");
  if (endOfFirstLine === -1) return null;

  // 查找结束 ---
  const closingIdx = trimmed.indexOf("\n---", endOfFirstLine + 1);
  if (closingIdx === -1) return null;

  const yamlBlock = trimmed.slice(4, closingIdx); // 跳过开头的 "---\n"
  const body = trimmed.slice(closingIdx + 4).trim(); // 跳过 "\n---"

  // 手写 YAML 解析：只处理简单的 key: value 行
  const frontmatter = parseSimpleYaml(yamlBlock);
  if (!frontmatter.name || !frontmatter.description) {
    return null;
  }

  return { frontmatter, body };
}

function parseSimpleYaml(yaml: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = {
    name: "",
    description: "",
    extra: {},
  };

  const lines = yaml.split("\n");
  let currentKey = "";
  let currentValue = "";
  let inMultiline = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (inMultiline) {
      // 多行值：继续追加（以缩进开头或非 key: value 格式的行）
      const keyMatch = line.match(/^(\w[\w-]*):\s+(.*)/);
      if (keyMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
        // 新的 key: value，结束多行
        setParsedValue(result, currentKey, currentValue.trim());
        currentKey = keyMatch[1];
        currentValue = keyMatch[2];
        inMultiline = false;
      } else {
        currentValue += "\n" + line;
      }
      continue;
    }

    if (line.trim() === "") continue;

    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!keyMatch) {
      // 不以 key: 开头 → 可能是上一行的多行续接
      if (currentKey) {
        currentValue += "\n" + line;
        inMultiline = true;
      }
      continue;
    }

    // 保存上一对
    if (currentKey) {
      setParsedValue(result, currentKey, currentValue.trim());
    }

    currentKey = keyMatch[1];
    currentValue = keyMatch[2] || "";
  }

  // 最后一对
  if (currentKey) {
    setParsedValue(result, currentKey, currentValue.trim());
  }

  return result;
}

function setParsedValue(
  fm: ParsedFrontmatter,
  key: string,
  value: string,
): void {
  // 去掉引号包裹
  const cleanValue = value.replace(/^['"](.*)['"]$/, "$1");

  switch (key) {
    case "name":
      fm.name = cleanValue;
      break;
    case "description":
      fm.description = cleanValue;
      break;
    default:
      fm.extra[key] = cleanValue;
  }
}

// ─── 文件系统扫描 ──────────────────────────────────────────

/**
 * 扫描 baseDir 下的所有 SKILL.md 文件，返回 DiscoveredSkill 列表。
 * 期望的目录结构：baseDir/<category>/<skill-name>/SKILL.md
 */
export async function scanSkillDirectories(
  baseDir: string,
): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = [];

  if (!fs.existsSync(baseDir)) {
    return skills;
  }

  // 读取分类目录（跳过 INDEX.md 和非目录）
  const categoryEntries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const catEntry of categoryEntries) {
    if (!catEntry.isDirectory()) continue;
    const categoryDir = path.join(baseDir, catEntry.name);
    const categorySlug = catEntry.name;

    // 读取 skill 目录
    const skillEntries = fs.readdirSync(categoryDir, { withFileTypes: true });
    for (const skillEntry of skillEntries) {
      if (!skillEntry.isDirectory()) continue;
      const skillDir = path.join(categoryDir, skillEntry.name);
      const skillMdPath = path.join(skillDir, "SKILL.md");

      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const skill = await loadSkillFromDirectory(
          skillDir,
          skillMdPath,
          categorySlug,
        );
        if (skill) {
          skills.push(skill);
        }
      } catch (err) {
        console.warn(
          `[SkillDiscovery] Failed to load skill at ${skillDir}:`,
          (err as Error).message,
        );
      }
    }
  }

  return skills;
}

async function loadSkillFromDirectory(
  skillDir: string,
  skillMdPath: string,
  categorySlug: string,
): Promise<DiscoveredSkill | null> {
  const content = fs.readFileSync(skillMdPath, "utf-8");
  const parsed = parseSkillMarkdown(content);

  if (!parsed) {
    console.warn(
      `[SkillDiscovery] Invalid SKILL.md at ${skillMdPath}: missing or malformed frontmatter`,
    );
    return null;
  }

  const { frontmatter, body } = parsed;

  // 加载 policy.json
  const policyPath = path.join(skillDir, "policy.json");
  let policy: SkillPolicy;

  if (fs.existsSync(policyPath)) {
    try {
      const policyRaw = fs.readFileSync(policyPath, "utf-8");
      policy = JSON.parse(policyRaw) as SkillPolicy;
    } catch (err) {
      console.warn(
        `[SkillDiscovery] Invalid policy.json at ${policyPath}, using strict defaults:`,
        (err as Error).message,
      );
      policy = { ...DEFAULT_POLICY };
    }
  } else {
    console.warn(
      `[SkillDiscovery] No policy.json found at ${policyPath}, using strict defaults`,
    );
    policy = { ...DEFAULT_POLICY };
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    version: policy.version || "0.0.0",
    category: categorySlug,
    displayName: policy.display_name || frontmatter.name,
    instructions: body,
    location: skillMdPath,
    baseDirectory: skillDir,
    policy,
    source: policy.trust_level || "builtin",
  };
}

// ─── 校验 ──────────────────────────────────────────────────

export function validateSkill(skill: DiscoveredSkill): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 必需字段校验
  if (!skill.name || skill.name.length === 0) {
    errors.push("name is required");
  }
  if (skill.name.length > 64) {
    warnings.push(`name exceeds 64 characters: "${skill.name}"`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(skill.name)) {
    warnings.push(
      `name should match [a-z][a-z0-9-]*: "${skill.name}"`,
    );
  }

  if (!skill.description || skill.description.length === 0) {
    errors.push("description is required");
  }

  if (!skill.instructions || skill.instructions.trim().length === 0) {
    errors.push("SKILL.md body (instructions) is empty");
  }

  // 目录名与 frontmatter name 一致性
  const dirName = path.basename(skill.baseDirectory);
  if (dirName !== skill.name) {
    warnings.push(
      `directory name "${dirName}" does not match skill name "${skill.name}"`,
    );
  }

  // policy 完整性
  if (!skill.policy.allowed_tools || skill.policy.allowed_tools.length === 0) {
    warnings.push("policy.allowed_tools is empty — skill will have no tool access");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── INDEX.md 解析 ─────────────────────────────────────────

/**
 * 解析后的 INDEX.md 分类信息
 */
export interface IndexCategory {
  slug: string;
  displayName: string;
}

export interface ParsedIndex {
  categories: IndexCategory[];
  raw: string;
}

/**
 * 解析 INDEX.md 文件。
 * 期望格式：## 分类名 (slug)
 * 提取 slug 与 displayName 的对应关系。
 */
export function parseIndexMd(content: string): ParsedIndex {
  const categories: IndexCategory[] = [];
  const headingRegex = /^##\s+(.+?)\s+\((\w+)\)\s*$/gm;

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    categories.push({
      displayName: match[1].trim(),
      slug: match[2],
    });
  }

  return { categories, raw: content };
}

/**
 * 加载 INDEX.md（如果存在），返回解析结果。
 */
export function loadIndexMd(baseDir: string): ParsedIndex | null {
  const indexPath = path.join(baseDir, "INDEX.md");
  if (!fs.existsSync(indexPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    return parseIndexMd(content);
  } catch (err) {
    console.warn(
      `[SkillDiscovery] Failed to read INDEX.md:`,
      (err as Error).message,
    );
    return null;
  }
}

// ─── Catalog 构建 ──────────────────────────────────────────

/**
 * 构建分类的 skill catalog。
 * 优先使用 INDEX.md 的分类排序，INDEX.md 中没有的 skill 归入 "uncategorized"。
 */
export function buildCatalog(
  skills: DiscoveredSkill[],
  index: ParsedIndex | null,
): SkillCatalogCategory[] {
  const categoryMap = new Map<string, SkillCatalogCategory>();

  // 从 INDEX.md 初始化分类顺序
  if (index) {
    for (const cat of index.categories) {
      categoryMap.set(cat.slug, {
        slug: cat.slug,
        displayName: cat.displayName,
        skills: [],
      });
    }
  }

  // 分配 skill 到分类
  for (const skill of skills) {
    const catSlug = skill.category || "uncategorized";
    let cat = categoryMap.get(catSlug);

    if (!cat) {
      cat = {
        slug: catSlug,
        displayName: skill.policy?.display_name
          ? `${skill.policy.display_name} 分类`
          : catSlug,
        skills: [],
      };
      categoryMap.set(catSlug, cat);
    }

    cat.skills.push({
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      source: skill.source,
      riskSummary: {
        ceiling: maxRiskLevel(skill.policy.allowed_risk_level),
        approval: skill.policy.default_approval_policy,
        external: skill.policy.data_handling?.may_send_to_external ?? false,
      },
    });
  }

  return [...categoryMap.values()];
}

function maxRiskLevel(levels: string[]): string {
  if (levels.length === 0) return "L1";
  const rank: Record<string, number> = {
    L0: 0,
    L1: 1,
    L2: 2,
    L3: 3,
    L4: 4,
  };
  let max = "L1";
  let maxR = 1;
  for (const l of levels) {
    const r = rank[l] ?? 0;
    if (r > maxR) {
      maxR = r;
      max = l;
    }
  }
  return max;
}

// ─── 文本形式的 Catalog（用于 System Prompt） ─────────────────

/**
 * 构建文本形式的 catalog 描述，适合直接注入 system prompt。
 */
export function buildCatalogDescription(
  catalog: SkillCatalogCategory[],
): string {
  if (catalog.length === 0) return "";

  const lines: string[] = ["## 可用技能"];

  for (const cat of catalog) {
    if (cat.skills.length === 0) continue;
    lines.push(`### ${cat.displayName}`);
    for (const skill of cat.skills) {
      lines.push(`- ${skill.name}: ${skill.description}`);
    }
  }

  return lines.join("\n");
}

// ─── 主入口 ────────────────────────────────────────────────

export interface DiscoveryResult {
  skills: DiscoveredSkill[];
  catalog: SkillCatalogCategory[];
  catalogDescription: string;
  index: ParsedIndex | null;
  errors: Array<{ skill: string; message: string }>;
  warnings: Array<{ skill: string; message: string }>;
}

/**
 * 一键执行完整 discovery 流程。
 */
export async function discoverAll(
  baseDir: string,
): Promise<DiscoveryResult> {
  const index = loadIndexMd(baseDir);
  const skills = await scanSkillDirectories(baseDir);

  const allErrors: Array<{ skill: string; message: string }> = [];
  const allWarnings: Array<{ skill: string; message: string }> = [];

  // 过滤掉无效 skill
  const validSkills: DiscoveredSkill[] = [];
  for (const skill of skills) {
    const validation = validateSkill(skill);
    if (!validation.valid) {
      for (const err of validation.errors) {
        allErrors.push({ skill: skill.name || skill.location, message: err });
      }
      // description 缺失 → 跳过
      if (validation.errors.some((e) => e.includes("description"))) {
        continue;
      }
    }
    for (const warn of validation.warnings) {
      allWarnings.push({ skill: skill.name, message: warn });
    }
    validSkills.push(skill);
  }

  // 交叉校验：INDEX.md 中列出的 skill 是否实际存在
  if (index) {
    for (const cat of index.categories) {
      for (const skill of validSkills) {
        if (skill.category === cat.slug) {
          // 检查 INDEX.md 中是否提到了这个 skill
          // 这是一个宽松的检查，通过 raw 文本查找
          if (!index.raw.includes(skill.name)) {
            allWarnings.push({
              skill: skill.name,
              message: `not mentioned in INDEX.md under category "${cat.slug}"`,
            });
          }
        }
      }
    }
  }

  const catalog = buildCatalog(validSkills, index);
  const catalogDescription = buildCatalogDescription(catalog);

  return {
    skills: validSkills,
    catalog,
    catalogDescription,
    index,
    errors: allErrors,
    warnings: allWarnings,
  };
}
