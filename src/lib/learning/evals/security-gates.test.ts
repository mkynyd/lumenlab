import { describe, expect, it } from "vitest";

import {
  toPracticeItemFeedback,
  toPublicPracticeItem,
  type PracticeItemPrivateDto,
} from "../contracts";
import {
  knowledgeMapGenerationSchema,
  practiceAttemptSubmissionSchema,
} from "../validators";

const privateItem: PracticeItemPrivateDto = {
  id: "item-1",
  lineageId: "lineage-1",
  version: 1,
  prompt: "2 + 2 = ?",
  type: "numeric",
  mode: "evidence_bearing",
  freshness: "current",
  sourceAnchors: [],
  answerCriteria: {
    kind: "numeric",
    expected: 4,
    absoluteTolerance: 0,
  },
  explanation: "2 与 2 相加得到 4。",
  generationMetadata: {
    provider: "fixture-provider",
    hiddenReasoning: "must-not-leak",
  },
};

describe("learning security eval gates", () => {
  it("does not leak criteria, explanation, or generation metadata pre-submit", () => {
    const payload = toPublicPracticeItem(privateItem);

    expect(payload).not.toHaveProperty("answerCriteria");
    expect(payload).not.toHaveProperty("explanation");
    expect(payload).not.toHaveProperty("generationMetadata");
    expect(JSON.stringify(payload)).not.toContain("must-not-leak");
  });

  it("reveals only the allowed explanation after submit", () => {
    const payload = toPracticeItemFeedback(privateItem);

    expect(payload.explanation).toBe(privateItem.explanation);
    expect(payload).not.toHaveProperty("answerCriteria");
    expect(payload).not.toHaveProperty("generationMetadata");
  });

  it.each([
    ["verdict", "correct"],
    ["score", 1],
    ["assistanceLevel", "independent"],
    ["spacingSeconds", 86_400],
  ])("rejects client-injected server-owned %s", (field, value) => {
    const result = practiceAttemptSubmissionSchema.safeParse({
      idempotencyKey: "attempt-key",
      answer: 4,
      [field]: value,
    });

    expect(result.success).toBe(false);
  });

  it("rejects model-forged source fingerprints and hashes", () => {
    const result = knowledgeMapGenerationSchema.safeParse({
      points: [
        {
          stableKey: "ohms-law",
          name: "欧姆定律",
          kind: "concept",
          order: 0,
          predecessorStableKeys: [],
          sourceHandles: ["server-handle-1"],
          contentFingerprint: "model-forged-fingerprint",
          excerptHash: "model-forged-hash",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
