/**
 * code-reader Skill manifest
 *
 * 覆盖范围：抓取 GitHub 公开仓库、生成代码理解报告。
 * 风险上限 L2：仅读 + 写 artifact。
 */

import type { SkillMetadata } from "../../agent/types";

export const CODE_READER_INSTRUCTIONS = `你正在帮用户读懂一份陌生代码。

## 工作流
1. 用 \`web.fetch\` 抓取 GitHub 公开仓库的 README / 主要源文件（白名单域名）；
2. 总结架构、关键模块、调用关系，输出 Markdown 报告；
3. 把报告保存为 \`artifact.save\`，type=code_explanation；
4. 不要删除任何项目资料；不要上传代码或调用外部付费服务。`;

export const CODE_READER_SKILL: SkillMetadata = {
  skillId: "code-reader",
  version: "1.0.0",
  description: "代码理解助手：抓取公开仓库、生成架构与关键路径说明。",
  instructions: CODE_READER_INSTRUCTIONS,
  allowedTools: [
    "web.fetch",
    "web.search",
    "artifact.save",
    "artifact.list",
  ],
  allowedRiskLevel: ["L1", "L2"],
  requiredScopes: ["artifact.write"],
  defaultApprovalPolicy: "ask_first",
  inputContract: {
    type: "object",
    properties: {
      repoUrl: { type: "string" },
      focusFile: { type: "string" },
    },
    required: ["repoUrl"],
  },
  outputContract: {
    type: "object",
    properties: {
      artifactId: { type: "string" },
      summary: { type: "string" },
    },
  },
  dataHandlingPolicy: {
    maySendToExternal: true,
    mayPersist: true,
    retentionDays: 30,
  },
};