import { describe, expect, it } from "vitest";

import {
  LEARNING_ERROR_CODES,
  toPracticeItemFeedback,
  toPublicPracticeItem,
  type PracticeItemPrivateDto,
} from "@/lib/learning/contracts";

describe("learning contracts", () => {
  it("freezes the service error codes used by every learning route", () => {
    expect(LEARNING_ERROR_CODES).toEqual([
      "learning_disabled",
      "not_found",
      "scope_not_confirmed",
      "source_unsupported",
      "answer_not_available",
      "evaluation_uncertain",
      "idempotency_conflict",
      "invalid_state",
    ]);
  });

  it("keeps answer criteria, explanation, and generation metadata private before submission", () => {
    const privateItem: PracticeItemPrivateDto = {
      id: "item-1",
      lineageId: "lineage-1",
      version: 2,
      prompt: "2 + 2 = ?",
      type: "numeric",
      mode: "evidence_bearing",
      explanation: "Addition combines two quantities.",
      freshness: "current",
      answerCriteria: {
        kind: "numeric",
        expected: 4,
        absoluteTolerance: 0,
        unit: null,
      },
      generationMetadata: {
        provider: "fixture",
        hiddenTrace: "must-not-leak",
      },
      sourceAnchors: [
        {
          id: "anchor-1",
          fileAssetId: "file-1",
          locator: { page: 3 },
          excerptHash: "sha256:excerpt",
        },
      ],
    };

    const publicItem = toPublicPracticeItem(privateItem);

    expect(publicItem).toEqual({
      id: "item-1",
      lineageId: "lineage-1",
      version: 2,
      prompt: "2 + 2 = ?",
      type: "numeric",
      mode: "evidence_bearing",
      freshness: "current",
      sourceAnchors: [
        {
          id: "anchor-1",
          fileAssetId: "file-1",
          locator: { page: 3 },
          excerptHash: "sha256:excerpt",
        },
      ],
    });
    expect(publicItem).not.toHaveProperty("answerCriteria");
    expect(publicItem).not.toHaveProperty("explanation");
    expect(publicItem).not.toHaveProperty("generationMetadata");
  });

  it("reveals explanation only through the post-submission feedback contract", () => {
    const item: PracticeItemPrivateDto = {
      id: "item-1",
      lineageId: "lineage-1",
      version: 1,
      prompt: "2 + 2 = ?",
      type: "numeric",
      mode: "evidence_bearing",
      explanation: "Addition combines two quantities.",
      freshness: "current",
      answerCriteria: {
        kind: "numeric",
        expected: 4,
        absoluteTolerance: 0,
        unit: null,
      },
      generationMetadata: null,
      sourceAnchors: [],
    };

    expect(toPracticeItemFeedback(item)).toMatchObject({
      id: "item-1",
      explanation: "Addition combines two quantities.",
    });
    expect(toPracticeItemFeedback(item)).not.toHaveProperty("answerCriteria");
    expect(toPracticeItemFeedback(item)).not.toHaveProperty(
      "generationMetadata"
    );
  });
});
