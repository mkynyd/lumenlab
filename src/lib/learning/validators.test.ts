import { describe, expect, it } from "vitest";

import {
  knowledgeMapGenerationSchema,
  learningScopeConfirmSchema,
  learningScopeDraftSchema,
  practiceAttemptSubmissionSchema,
  practiceItemGenerationSchema,
} from "@/lib/learning/validators";

describe("learning model-output validators", () => {
  it("keeps draft editing and confirmation as separate commands", () => {
    expect(
      learningScopeDraftSchema.parse({
        expectedVersion: 0,
        definition: { modules: ["直流电路"] },
        materialMode: "project_corpus",
        fileIds: [],
        materialGaps: [],
        idempotencyKey: "scope-draft-1",
      })
    ).not.toHaveProperty("status");
    expect(
      learningScopeConfirmSchema.parse({
        expectedVersion: 1,
        idempotencyKey: "scope-confirm-1",
      })
    ).toEqual({
      expectedVersion: 1,
      idempotencyKey: "scope-confirm-1",
    });
    expect(() =>
      learningScopeConfirmSchema.parse({
        expectedVersion: 1,
        idempotencyKey: "scope-confirm-1",
        status: "confirmed",
      })
    ).toThrow();
  });

  it("accepts a versioned knowledge point with a project source anchor", () => {
    expect(
      knowledgeMapGenerationSchema.parse({
        points: [
          {
            stableKey: "kirchhoff-current-law",
            name: "基尔霍夫电流定律",
            kind: "concept",
            order: 1,
            sourceHandles: ["scope-source-1"],
          },
        ],
      })
    ).toMatchObject({
      points: [{ stableKey: "kirchhoff-current-law" }],
    });
  });

  it("rejects evidence-bearing questions without a source anchor", () => {
    expect(() =>
      practiceItemGenerationSchema.parse({
        stableKey: "kcl-basic-1",
        prompt: "流入节点的电流和流出节点的电流有什么关系？",
        type: "short_answer",
        mode: "evidence_bearing",
        answerCriteria: {
          kind: "keywords",
          required: ["相等"],
        },
        explanation: "依据节点电流守恒。",
        sourceHandles: [],
        knowledgePointStableKeys: ["kirchhoff-current-law"],
      })
    ).toThrow();
  });

  it("rejects model-supplied source hashes instead of trusting them", () => {
    expect(() =>
      knowledgeMapGenerationSchema.parse({
        points: [
          {
            stableKey: "kirchhoff-current-law",
            name: "基尔霍夫电流定律",
            kind: "concept",
            order: 1,
            sourceHandles: ["scope-source-1"],
            contentFingerprint: "model-forged-fingerprint",
            excerptHash: "model-forged-excerpt",
          },
        ],
      })
    ).toThrow();
  });

  it("requires structured choice options and a valid selected option ID", () => {
    expect(() =>
      practiceItemGenerationSchema.parse({
        stableKey: "kcl-choice-1",
        prompt: "哪个选项符合 KCL？",
        type: "single_choice",
        mode: "evidence_bearing",
        options: [
          { id: "a", label: "流入电流等于流出电流" },
          { id: "b", label: "电压总是为零" },
        ],
        answerCriteria: {
          kind: "single_choice",
          selectedOptionId: "c",
        },
        explanation: "KCL 表达节点电流守恒。",
        sourceHandles: ["scope-source-1"],
        knowledgePointStableKeys: ["kirchhoff-current-law"],
      })
    ).toThrow();
  });

  it("rejects client attempts that try to inject grading or assistance state", () => {
    expect(() =>
      practiceAttemptSubmissionSchema.parse({
        idempotencyKey: "attempt-send-1",
        answer: "4",
        score: 1,
        verdict: "correct",
        assistanceLevel: "independent",
        spacingSeconds: 600,
      })
    ).toThrow();
  });
});
