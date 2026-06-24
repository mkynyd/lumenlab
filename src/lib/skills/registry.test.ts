import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_WEB_SEARCH_TYPE,
  buildToolsPayloadForProvider,
  SKILL_LIST_PROJECT_FILES,
  SKILL_SEARCH_PROJECT_FILES,
  SKILL_WEB_SEARCH,
  PAPER_READER_SKILL,
  EXAM_EXTRACT_SKILL,
  SOCRATIC_TUTOR_SKILL,
  PAPER_WRITER_SKILL,
  EXAM_COACH_SKILL,
} from "./registry";
import { skillRegistry } from "../agent/skill-registry";
import { toolRegistry } from "../agent/tool-registry";
import "../tools/registry";

describe("skills registry provider payload", () => {
  it("DEEPSEEK_WEB_SEARCH_TYPE constant matches Anthropic SDK shape", () => {
    expect(DEEPSEEK_WEB_SEARCH_TYPE).toBe("web_search_20250305");
  });

  it("returns undefined for empty skill list", () => {
    expect(buildToolsPayloadForProvider([], "deepseek")).toBeUndefined();
  });

  it("returns undefined for client-only skills on DeepSeek (no 400)", () => {
    expect(
      buildToolsPayloadForProvider(
        [SKILL_SEARCH_PROJECT_FILES, SKILL_LIST_PROJECT_FILES],
        "deepseek"
      )
    ).toBeUndefined();
  });

  it("returns undefined on MiniMax (tool-less)", () => {
    expect(
      buildToolsPayloadForProvider([SKILL_WEB_SEARCH], "minimax")
    ).toBeUndefined();
    expect(
      buildToolsPayloadForProvider(
        [SKILL_WEB_SEARCH, SKILL_LIST_PROJECT_FILES],
        "minimax"
      )
    ).toBeUndefined();
  });

  it("returns only the versioned web_search entry on DeepSeek", () => {
    expect(
      buildToolsPayloadForProvider([SKILL_WEB_SEARCH], "deepseek")
    ).toEqual([{ type: "web_search_20250305", name: "web_search" }]);
  });

  it("filters out client skills on DeepSeek", () => {
    expect(
      buildToolsPayloadForProvider(
        [SKILL_WEB_SEARCH, SKILL_SEARCH_PROJECT_FILES, SKILL_LIST_PROJECT_FILES],
        "deepseek"
      )
    ).toEqual([{ type: "web_search_20250305", name: "web_search" }]);
  });
});

describe("new skill allowlists align with registered tools", () => {
  function assertAllToolsExist(skill: { allowedTools: string[] }, name: string) {
    for (const toolId of skill.allowedTools) {
      expect(
        toolRegistry.has(toolId),
        `Tool ${toolId} must be registered for skill ${name}`
      ).toBe(true);
    }
  }

  it("paper-reader Skill is registered with valid allowlist", () => {
    const skill = skillRegistry.require("paper-reader");
    expect(skill.version).toBe(PAPER_READER_SKILL.version);
    assertAllToolsExist(skill, "paper-reader");
    expect(skill.allowedTools).toContain("arxiv.search");
    expect(skill.allowedTools).toContain("arxiv.read");
    expect(skill.allowedTools).toContain("reference.add");
    expect(skill.allowedTools).toContain("artifact.export_docx");
  });

  it("exam-extract Skill is registered with valid allowlist", () => {
    const skill = skillRegistry.require("exam-extract");
    assertAllToolsExist(skill, "exam-extract");
    expect(skill.allowedTools).not.toContain("arxiv.search");
  });

  it("socratic-tutor Skill is L1/L2 only and defaults to auto", () => {
    const skill = skillRegistry.require("socratic-tutor");
    assertAllToolsExist(skill, "socratic-tutor");
    expect(skill.defaultApprovalPolicy).toBe("auto");
    expect(skill.allowedRiskLevel).toEqual(["L1", "L2"]);
  });

  it("exam-coach v1.1.0 still allows the original tools", () => {
    const skill = skillRegistry.require("exam-coach");
    expect(skill.version).toBe(EXAM_COACH_SKILL.version);
    assertAllToolsExist(skill, "exam-coach");
  });

  it("paper-writer keeps stable allowlist", () => {
    const skill = skillRegistry.require("paper-writer");
    assertAllToolsExist(skill, "paper-writer");
    expect(skill).toBe(PAPER_WRITER_SKILL);
  });

  it("all new skills export required metadata fields", () => {
    for (const skill of [
      PAPER_READER_SKILL,
      EXAM_EXTRACT_SKILL,
      SOCRATIC_TUTOR_SKILL,
    ]) {
      expect(skill.skillId).toBeTruthy();
      expect(skill.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(skill.instructions.length).toBeGreaterThan(200);
      expect(skill.allowedTools.length).toBeGreaterThan(0);
      expect(skill.requiredScopes.length).toBeGreaterThan(0);
      expect(skill.dataHandlingPolicy.mayPersist).toBeDefined();
    }
  });
});