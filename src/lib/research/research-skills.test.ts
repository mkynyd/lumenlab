import { describe, expect, it } from "vitest";
import { discoverEffectiveSkills } from "@/lib/skills/layers";
import { buildResearchPlan } from "./plan";
import { buildResearchSkillRunConfiguration, methodologyForStage, publicResearchSkillSnapshot, resolveResearchSkills } from "./research-skills";

describe("Research Skill Compilation v1", () => {
  it("always selects core and keeps ordinary factual research selective", () => {
    const plan = buildResearchPlan({ question: "重庆大学建校于哪一年？", profile: "quick" });
    const selected = resolveResearchSkills(plan, plan.domainProfile, "planner");
    expect(selected).toEqual(["deep-research-core"]);
    expect(selected).not.toEqual(expect.arrayContaining(["paper-writer", "humanizer-zh", "figure-style"]));
  });

  it.each([
    "请写一份大模型推理优化的文献综述",
    "研究 2024 年后的主要技术趋势",
    "比较 RAG 与长上下文方法",
    "分析该领域的 state of the art 和 research gap",
  ])("selects literature-review for analytical request: %s", (question) => {
    const plan = buildResearchPlan({ question, profile: "deep" });
    expect(resolveResearchSkills(plan, plan.domainProfile, "retrieval")).toContain("literature-review");
  });

  it("selects paper-reader only for explicit close reading", () => {
    const explicit = buildResearchPlan({ question: "精读 arXiv:2401.12345 的方法章节与图 3 实验数据", profile: "deep" });
    const broad = buildResearchPlan({ question: "有哪些多模态研究方法？", profile: "deep" });
    expect(resolveResearchSkills(explicit, explicit.domainProfile, "claim")).toContain("paper-reader");
    expect(resolveResearchSkills(broad, broad.domainProfile, "claim")).not.toContain("paper-reader");
  });

  it("compiles bounded stage sections and freezes an auditable run snapshot", async () => {
    const plan = buildResearchPlan({ question: "综述神经渲染的研究趋势与局限", profile: "deep" });
    const configuration = await buildResearchSkillRunConfiguration(plan);
    expect(configuration.skills.map((item) => item.skillId)).toEqual(expect.arrayContaining(["deep-research-core", "literature-review"]));
    expect(configuration.skills[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(configuration.compiledByStage.planner).toContain("intent and planning");
    expect(configuration.compiledByStage.planner).not.toContain("## final audit");
    expect(configuration.compiledByStage.writer).toContain("综述是比较，不是摘要");
    expect(configuration.compiledByStage.writer.length).toBeLessThan(10_000);
    expect(configuration.compiledByStage.verifier).toContain("不能修改工具集合");
    const wrapped = { researchSkills: configuration };
    expect(methodologyForStage(wrapped, "writer")).toBe(configuration.compiledByStage.writer);
    const publicSnapshot = publicResearchSkillSnapshot(wrapped);
    expect(publicSnapshot?.skills).toEqual(configuration.skills);
    expect(publicSnapshot).not.toHaveProperty("compiledByStage");
  });

  it("keeps an existing run snapshot immutable while a new run sees a promoted version", async () => {
    const plan = buildResearchPlan({ question: "分析一个普通事实问题", profile: "quick" });
    const discovered = (await discoverEffectiveSkills()).skills;
    const original = await buildResearchSkillRunConfiguration(plan, discovered);
    const changed = discovered.map((skill) => skill.name === "deep-research-core"
      ? { ...skill, version: "9.9.9", instructions: `${skill.instructions}\n\nA newly promoted methodology rule.` }
      : skill);
    const next = await buildResearchSkillRunConfiguration(plan, changed);
    expect(original.skills[0].version).not.toBe("9.9.9");
    expect(next.skills[0].version).toBe("9.9.9");
    expect(next.skills[0].contentHash).not.toBe(original.skills[0].contentHash);
    expect(original.compiledByStage.writer).not.toContain("newly promoted methodology rule");
  });
});
