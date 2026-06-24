/**
 * paper-reader Skill manifest
 *
 * 三档深度论文速读（基于 paper-quick-reader）
 */

import type { SkillMetadata } from "../../agent/types";
import { PAPER_READER_INSTRUCTIONS } from "./instructions";

export { PAPER_READER_INSTRUCTIONS };

export const PAPER_READER_SKILL: SkillMetadata = {
  skillId: "paper-reader",
  version: "1.0.0",
  description: "论文速读：三档深度（裸读 / 引导 / 精读）+ 中文输出 + 页码 provenance。",
  instructions: PAPER_READER_INSTRUCTIONS,
  allowedTools: [
    "project_files.list",
    "project_files.read",
    "project_rag.search",
    "arxiv.search",
    "arxiv.read",
    "arxiv.fetch",
    "web.fetch",
    "reference.add",
    "reference.list",
    "reference.attach",
    "reference.format",
    "artifact.save",
    "artifact.list",
    "artifact.export_docx",
  ],
  allowedRiskLevel: ["L1", "L2", "L3"],
  requiredScopes: ["project.read", "artifact.write"],
  defaultApprovalPolicy: "ask_first",
  inputContract: {
    type: "object",
    properties: {
      papers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            source: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: ["arxiv_id", "pdf_file_id", "pasted_text"],
                },
                content: { type: "string" },
              },
              required: ["kind", "content"],
            },
          },
          required: ["source"],
        },
      },
      compare_dimensions: {
        type: "array",
        items: { type: "string" },
      },
      context: {
        type: "object",
        properties: {
          my_direction: { type: "string" },
          specific_question: { type: "string" },
        },
      },
      preferences: {
        type: "object",
        properties: {
          language: { type: "string", enum: ["zh", "en", "bilingual"] },
          depth_hint: {
            type: "string",
            enum: ["auto", "force_skim", "force_deep"],
          },
        },
      },
    },
    required: ["papers"],
  },
  outputContract: {
    type: "object",
    properties: {
      summaryCard: { type: "object" },
      connectionPoints: { type: "array" },
      deepDiveAnswers: { type: "array" },
      comparison: { type: "object" },
      artifactIds: { type: "array", items: { type: "string" } },
    },
  },
  dataHandlingPolicy: {
    maySendToExternal: true,
    mayPersist: true,
    retentionDays: 90,
  },
};