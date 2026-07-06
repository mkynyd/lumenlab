/**
 * SkillDiscovery 模块测试
 */
import { describe, expect, it } from "vitest";
import {
  parseSkillMarkdown,
  validateSkill,
  buildCatalog,
  parseIndexMd,
  buildCatalogDescription,
} from "./discovery";
import type { DiscoveredSkill } from "./discovery";

// 模拟一个完整的 SKILL.md 内容
const VALID_SKILL_MD = `---
name: test-skill
description: A test skill for unit testing.
---

# Test Skill

This is the body of the skill.
`;

const MISSING_DESC = `---
name: test-skill
---

Body without description.
`;

const NO_FRONTMATTER = `# Just markdown

No frontmatter here.
`;

const INDEX_MD = `# LumenLab Skills

## 论文学术 (academic)

- **paper-reader** -- 论文速读
- **paper-writer** -- 论文写作助手

## 考试复习 (exam)

- **exam-coach** -- 复习教练
`;

describe("parseSkillMarkdown", () => {
  it("parses valid SKILL.md with frontmatter", () => {
    const result = parseSkillMarkdown(VALID_SKILL_MD);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("test-skill");
    expect(result!.frontmatter.description).toBe(
      "A test skill for unit testing.",
    );
    expect(result!.body).toContain("# Test Skill");
    expect(result!.body).toContain("This is the body of the skill.");
  });

  it("returns null when description is missing", () => {
    const result = parseSkillMarkdown(MISSING_DESC);
    expect(result).toBeNull();
  });

  it("returns null when there is no frontmatter", () => {
    const result = parseSkillMarkdown(NO_FRONTMATTER);
    expect(result).toBeNull();
  });
});

describe("validateSkill", () => {
  function makeSkill(overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
    return {
      name: "test-skill",
      description: "A test skill",
      version: "1.0.0",
      category: "test",
      displayName: "Test Skill",
      instructions: "# Hello",
      location: "/fake/test-skill/SKILL.md",
      baseDirectory: "/fake/test-skill",
      policy: {
        version: "1.0.0",
        category: "test",
        display_name: "Test Skill",
        trust_level: "builtin",
        enabled: true,
        allowed_tools: ["project_files.read"],
        allowed_risk_level: ["L1", "L2"],
        default_approval_policy: "ask_first",
        required_scopes: [],
        input_contract: {},
        output_contract: {},
        data_handling: { may_send_to_external: false, may_persist: false },
        triggers: { include: [], exclude: [] },
        resources: { allow: [], deny: [] },
      },
      source: "builtin",
      ...overrides,
    };
  }

  it("validates a complete skill", () => {
    const result = validateSkill(makeSkill());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags missing description", () => {
    const result = validateSkill(makeSkill({ description: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("description is required");
  });

  it("flags missing instructions", () => {
    const result = validateSkill(makeSkill({ instructions: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "SKILL.md body (instructions) is empty",
    );
  });

  it("warns on name exceeding 64 chars", () => {
    const result = validateSkill(
      makeSkill({ name: "a".repeat(65) }),
    );
    expect(result.warnings.some((w) => w.includes("64"))).toBe(true);
  });

  it("warns when directory name does not match skill name", () => {
    const result = validateSkill(
      makeSkill({
        name: "other-name",
        baseDirectory: "/fake/test-skill",
      }),
    );
    expect(
      result.warnings.some((w) => w.includes("directory name")),
    ).toBe(true);
  });
});

describe("parseIndexMd", () => {
  it("extracts categories from INDEX.md", () => {
    const result = parseIndexMd(INDEX_MD);
    expect(result.categories).toHaveLength(2);
    expect(result.categories[0]).toEqual({
      displayName: "论文学术",
      slug: "academic",
    });
    expect(result.categories[1]).toEqual({
      displayName: "考试复习",
      slug: "exam",
    });
  });
});

describe("buildCatalog", () => {
  it("builds a categorized catalog", () => {
    const skills: DiscoveredSkill[] = [
      {
        name: "paper-reader",
        description: "论文速读",
        version: "1.0.0",
        category: "academic",
        displayName: "论文速读",
        instructions: "...",
        location: "/fake/paper-reader/SKILL.md",
        baseDirectory: "/fake/paper-reader",
        policy: {
          version: "1.0.0",
          category: "academic",
          display_name: "论文速读",
          trust_level: "builtin",
          enabled: true,
          allowed_tools: [],
          allowed_risk_level: ["L1", "L2", "L3"],
          default_approval_policy: "ask_first",
          required_scopes: [],
          input_contract: {},
          output_contract: {},
          data_handling: {
            may_send_to_external: true,
            may_persist: true,
            retention_days: 90,
          },
          triggers: { include: [], exclude: [] },
          resources: { allow: [], deny: [] },
        },
        source: "builtin",
      },
    ];

    const index = parseIndexMd(INDEX_MD);
    const catalog = buildCatalog(skills, index);

    expect(catalog).toHaveLength(2); // academic + exam
    expect(catalog[0].slug).toBe("academic");
    expect(catalog[0].skills).toHaveLength(1);
    expect(catalog[0].skills[0].name).toBe("paper-reader");
    expect(catalog[0].skills[0].riskSummary.ceiling).toBe("L3");
    expect(catalog[0].skills[0].riskSummary.external).toBe(true);
  });
});

describe("buildCatalogDescription", () => {
  it("produces compact markdown for system prompt", () => {
    const catalog = [
      {
        slug: "academic",
        displayName: "论文学术",
        skills: [
          {
            name: "paper-reader",
            displayName: "论文速读",
            description: "三层深度阅读",
            version: "1.0.0",
            source: "builtin",
            riskSummary: {
              ceiling: "L3",
              approval: "ask_first",
              external: true,
            },
          },
        ],
      },
    ];

    const desc = buildCatalogDescription(catalog);
    expect(desc).toContain("## 可用技能");
    expect(desc).toContain("### 论文学术");
    expect(desc).toContain("paper-reader");
    expect(desc).toContain("三层深度阅读");
  });

  it("returns empty string for empty catalog", () => {
    expect(buildCatalogDescription([])).toBe("");
  });
});
