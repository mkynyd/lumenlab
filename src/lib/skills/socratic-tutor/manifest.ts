/**
 * socratic-tutor Skill manifest
 *
 * 苏格拉底式学业导师（基于 academic-tutor）。
 */

import type { SkillMetadata } from "../../agent/types";
import { SOCRATIC_TUTOR_INSTRUCTIONS } from "./instructions";

export { SOCRATIC_TUTOR_INSTRUCTIONS };

export const SOCRATIC_TUTOR_SKILL: SkillMetadata = {
  skillId: "socratic-tutor",
  version: "1.0.0",
  description: "苏格拉底式学业导师：拆思路不塞答案，覆盖全学科。",
  instructions: SOCRATIC_TUTOR_INSTRUCTIONS,
  allowedTools: [
    "project_files.list",
    "project_files.read",
    "project_rag.search",
    "artifact.save",
    "artifact.list",
  ],
  allowedRiskLevel: ["L1", "L2"],
  requiredScopes: ["project.read", "artifact.write"],
  defaultApprovalPolicy: "auto",
  inputContract: {
    type: "object",
    properties: {
      question: { type: "string" },
      subject: { type: "string" },
      stuckStep: { type: "string" },
    },
    required: ["question"],
  },
  outputContract: {
    type: "object",
    properties: {
      turn: { type: "integer" },
      prompt: { type: "string" },
      hint: { type: "string" },
      nextStep: { type: "string" },
      artifactId: { type: "string" },
    },
  },
  dataHandlingPolicy: {
    maySendToExternal: false,
    mayPersist: true,
    retentionDays: 30,
  },
};