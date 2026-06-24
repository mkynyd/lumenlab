/**
 * exam-extract Skill manifest
 *
 * Syllabus-driven 抽取，严格基于项目资料（基于 exam-ready）。
 */

import type { SkillMetadata } from "../../agent/types";
import { EXAM_EXTRACT_INSTRUCTIONS } from "./instructions";

export { EXAM_EXTRACT_INSTRUCTIONS };

export const EXAM_EXTRACT_SKILL: SkillMetadata = {
  skillId: "exam-extract",
  version: "1.0.0",
  description: "考题要点抽取：syllabus-driven 模板，严格基于项目资料不外延。",
  instructions: EXAM_EXTRACT_INSTRUCTIONS,
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
      syllabusTopics: {
        type: "array",
        items: { type: "string" },
      },
      examType: {
        type: "string",
        enum: ["mcq", "short-answer", "long-answer"],
      },
      hoursAvailable: { type: "number", minimum: 0 },
      triage: { type: "boolean", default: false },
    },
    required: ["syllabusTopics"],
  },
  outputContract: {
    type: "object",
    properties: {
      priorityOrder: { type: "array", items: { type: "string" } },
      extractedTopics: { type: "array" },
      artifactIds: { type: "array", items: { type: "string" } },
      missingTopics: { type: "array", items: { type: "string" } },
    },
  },
  dataHandlingPolicy: {
    maySendToExternal: false,
    mayPersist: true,
    retentionDays: 30,
  },
};