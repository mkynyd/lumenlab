/**
 * paper-writer Skill manifest
 *
 * 覆盖范围：项目资料读取、联网检索、整理引用、保存草稿。
 * 不允许删除资料或导出到外部平台。
 */

import type { SkillMetadata } from "../../agent/types";

export const PAPER_WRITER_INSTRUCTIONS = `你正在帮用户撰写或修订学术论文。

## 工作流
1. 优先用 \`project_files.list\` + \`project_files.read\` 读取用户提供的资料 PDF / 笔记；
2. 必要时调用 \`web.search\` / \`web.fetch\` 检索外部文献（仅 arxiv / wikipedia / openreview）；
3. 用 Markdown 写初稿，每次保存用 \`artifact.save\`，标题清晰反映章节；
4. 不要主动删除资料，不要发布到任何外部平台。

## 引用规范
- 论文正文中的引用使用 \`[n]\` 数字编号；
- 文末给出对应的 \`## References\` 列表，注明 title / authors / year / url。`;

export const PAPER_WRITER_SKILL: SkillMetadata = {
  skillId: "paper-writer",
  version: "1.0.0",
  description: "论文写作助手：读取资料、联网检索、整理引用、保存草稿。",
  instructions: PAPER_WRITER_INSTRUCTIONS,
  allowedTools: [
    "project_files.list",
    "project_files.read",
    "project_rag.search",
    "web.search",
    "web.fetch",
    "artifact.save",
    "artifact.list",
  ],
  allowedRiskLevel: ["L1", "L2"],
  requiredScopes: ["project.read", "artifact.write"],
  defaultApprovalPolicy: "ask_first",
  inputContract: {
    type: "object",
    properties: {
      topic: { type: "string" },
      draftType: {
        type: "string",
        enum: ["outline", "introduction", "section", "revision", "abstract"],
      },
    },
    required: ["topic"],
  },
  outputContract: {
    type: "object",
    properties: {
      artifactId: { type: "string" },
      references: { type: "array" },
    },
  },
  dataHandlingPolicy: {
    maySendToExternal: true,
    mayPersist: true,
    retentionDays: 90,
  },
};