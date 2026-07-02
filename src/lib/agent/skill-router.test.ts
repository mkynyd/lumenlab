import { describe, expect, it } from "vitest";
import { routeSkill } from "./skill-router";

describe("skill router", () => {
  it("keeps manual skill selection ahead of rule routing", () => {
    const route = routeSkill({
      message: "请帮我抓考试重点",
      manualSkillId: "socratic-tutor",
      projectId: "project-1",
      selectedFileIds: ["file-1"],
    });

    expect(route.activeSkillId).toBe("socratic-tutor");
    expect(route.source).toBe("manual");
    expect(route.status).toBe("active");
  });

  it("activates paper-reader as awaiting_context when the user asks to read a paper without material", () => {
    const route = routeSkill({
      message: "帮我精读 arXiv:2401.00001 这篇论文",
    });

    expect(route.activeSkillId).toBe("paper-reader");
    expect(route.status).toBe("awaiting_context");
    expect(route.missingInfo).toContain(
      "请上传文档、粘贴论文编号（例如 arXiv ID ），或选择项目资料。"
    );
    expect(route.profile).toBe("research");
  });

  it("routes Chinese university PPT chapter names to exam-extract when exam intent is explicit", () => {
    const route = routeSkill({
      message: "根据这些 PPT 抓考试重点和可能的大题",
      projectId: "project-1",
      selectedFiles: [
        { id: "f1", name: "第1章-绪论.pptx", mimeType: "application/vnd.ms-powerpoint" },
        { id: "f2", name: "2_数据库索引结构.pptx", mimeType: "application/vnd.ms-powerpoint" },
      ],
    });

    expect(route.activeSkillId).toBe("exam-extract");
    expect(route.status).toBe("active");
    expect(route.profile).toBe("rag");
  });

  it("keeps ordinary file summaries on the RAG path and suggests deeper follow-up skills", () => {
    const route = routeSkill({
      message: "总结一下这份章节资料",
      projectId: "project-1",
      selectedFileIds: ["file-1"],
    });

    expect(route.activeSkillId).toBeNull();
    expect(route.status).toBe("none");
    expect(route.profile).toBe("rag");
    expect(route.suggestions.map((item) => item.skillId)).toContain("socratic-tutor");
    expect(route.suggestions.map((item) => item.skillId)).toContain("exam-extract");
  });

  it("covers the built-in writing, code, coaching, and Socratic skills", () => {
    expect(routeSkill({ message: "帮我写一篇 IEEE 风格论文初稿" }).activeSkillId)
      .toBe("paper-writer");
    expect(routeSkill({ message: "解释这个 TypeScript 项目的调用链" }).activeSkillId)
      .toBe("code-reader");
    expect(routeSkill({ message: "给我生成速记卡和自测题" }).activeSkillId)
      .toBe("exam-coach");
    expect(routeSkill({ message: "用苏格拉底式提问引导我理解这个概念" }).activeSkillId)
      .toBe("socratic-tutor");
  });

  it("forces no skill when the user turns skill off for this message", () => {
    const route = routeSkill({
      message: "帮我抓考试重点",
      projectId: "project-1",
      selectedFileIds: ["file-1"],
      skillOff: true,
    });

    expect(route.activeSkillId).toBeNull();
    expect(route.status).toBe("none");
    expect(route.source).toBe("manual");
    expect(route.reason).toContain("turned skill off");
  });

  it("forces no skill when the conversation has skillDisabled set", () => {
    const route = routeSkill({
      message: "帮我抓考试重点",
      projectId: "project-1",
      selectedFileIds: ["file-1"],
      skillDisabled: true,
    });

    expect(route.activeSkillId).toBeNull();
    expect(route.status).toBe("none");
    expect(route.source).toBe("manual");
    expect(route.reason).toContain("disabled");
  });

  it("keeps manual skill selection ahead of skillOff", () => {
    const route = routeSkill({
      message: "随便聊聊",
      manualSkillId: "socratic-tutor",
      skillOff: true,
    });

    expect(route.activeSkillId).toBe("socratic-tutor");
    expect(route.source).toBe("manual");
  });
});

describe("routeSkill quick task", () => {
  it("项目中的快捷任务强制返回 rag profile，即使 prompt 不含资料关键词", () => {
    const result = routeSkill({
      message: "快捷任务：总结要点",
      hiddenPrompt: "请总结要点",
      projectId: "proj-123",
      isQuickTask: true,
    });
    expect(result.profile).toBe("rag");
  });

  it("项目快捷任务可以使用全项目资料，不要求先选择单个文件", () => {
    const result = routeSkill({
      message: "快捷任务：生成速记卡",
      hiddenPrompt: "请基于项目资料生成速记卡和自测题",
      projectId: "proj-123",
      isQuickTask: true,
    });

    expect(result.activeSkillId).toBe("exam-coach");
    expect(result.status).toBe("active");
    expect(result.missingInfo).toEqual([]);
  });

  it("非快捷任务且不含资料关键词时保持 simple", () => {
    const result = routeSkill({
      message: "你好",
      projectId: "proj-123",
    });
    expect(result.profile).toBe("simple");
  });
});
