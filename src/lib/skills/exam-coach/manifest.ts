/**
 * exam-coach Skill manifest
 *
 * instructions 拆到 ./instructions.ts（基于 exam-prep 工作流）。
 */

import type { SkillMetadata } from "../../agent/types";
import { EXAM_COACH_INSTRUCTIONS } from "./instructions";

export { EXAM_COACH_INSTRUCTIONS };

export const EXAM_COACH_SKILL: SkillMetadata = {
  skillId: "exam-coach",
  version: "1.1.0",
  description: "复习教练：错题整理、学习计划、复习卡片生成（exam-prep 工作流）。",
  instructions: EXAM_COACH_INSTRUCTIONS,
  allowedTools: [
    "project_files.list",
    "project_files.read",
    "project_rag.search",
    "artifact.save",
    "artifact.list",
  ],
  allowedRiskLevel: ["L1", "L2"],
  requiredScopes: ["project.read", "artifact.write"],
  defaultApprovalPolicy: "ask_first",
  inputContract: {
    type: "object",
    properties: {
      examName: { type: "string" },
      daysUntilExam: { type: "integer", minimum: 0 },
      hoursPerDay: { type: "number", minimum: 0 },
      focusAreas: { type: "array", items: { type: "string" } },
    },
    required: ["examName"],
  },
  outputContract: {
    type: "object",
    properties: {
      planArtifactId: { type: "string" },
      cardArtifactIds: { type: "array", items: { type: "string" } },
      weakTopics: { type: "array", items: { type: "string" } },
    },
  },
  dataHandlingPolicy: {
    maySendToExternal: false,
    mayPersist: true,
    retentionDays: 60,
  },
};