import { describe, expect, it } from "vitest";

import { evaluateEvidence } from "./index";

const correct = {
  mode: "evidence_bearing" as const,
  verdict: "correct" as const,
  score: 1,
};

describe("evaluateEvidence", () => {
  it("never treats feedback-only work as mastery evidence", () => {
    expect(
      evaluateEvidence({
        ...correct,
        mode: "feedback_only",
        assistanceLevel: "independent",
        spacingSeconds: 7 * 24 * 60 * 60,
      }),
    ).toEqual({
      policyVersion: "evidence-v1",
      eligibleForMastery: false,
      spacingBand: "spaced",
      strength: "none",
      contribution: 0,
      correct: true,
      spaced: true,
    });
  });

  it("uses assistance and actual elapsed spacing as independent dimensions", () => {
    const independentImmediate = evaluateEvidence({
      ...correct,
      assistanceLevel: "independent",
      spacingSeconds: 60,
    });
    const independentSpaced = evaluateEvidence({
      ...correct,
      assistanceLevel: "independent",
      spacingSeconds: 2 * 24 * 60 * 60,
    });
    const hintedSpaced = evaluateEvidence({
      ...correct,
      assistanceLevel: "hinted",
      spacingSeconds: 2 * 24 * 60 * 60,
    });
    const exposedSpaced = evaluateEvidence({
      ...correct,
      assistanceLevel: "answer_exposed",
      spacingSeconds: 2 * 24 * 60 * 60,
    });

    expect(independentSpaced.contribution).toBeGreaterThan(
      independentImmediate.contribution,
    );
    expect(independentSpaced.contribution).toBeGreaterThan(
      hintedSpaced.contribution,
    );
    expect(hintedSpaced.contribution).toBeGreaterThan(
      exposedSpaced.contribution,
    );
    expect(independentSpaced).toMatchObject({
      spacingBand: "spaced",
      strength: "strong",
      contribution: 1,
      eligibleForMastery: true,
    });
  });

  it("prevents an immediate answer-exposed redo from being mastery evidence alone", () => {
    expect(
      evaluateEvidence({
        ...correct,
        assistanceLevel: "answer_exposed",
        spacingSeconds: 30,
      }),
    ).toMatchObject({
      spacingBand: "immediate",
      strength: "weak",
      contribution: 0.05,
      eligibleForMastery: false,
      correct: true,
      spaced: false,
    });
  });

  it("allows a spaced same-item independent attempt to carry strong evidence", () => {
    expect(
      evaluateEvidence({
        ...correct,
        assistanceLevel: "independent",
        spacingSeconds: 24 * 60 * 60,
      }),
    ).toMatchObject({
      spacingBand: "spaced",
      strength: "strong",
      contribution: 1,
      eligibleForMastery: true,
    });
  });

  it("applies verdict quality without inventing evidence for uncertain grading", () => {
    expect(
      evaluateEvidence({
        mode: "evidence_bearing",
        verdict: "partial",
        score: 0.5,
        assistanceLevel: "independent",
        spacingSeconds: 24 * 60 * 60,
      }),
    ).toMatchObject({
      contribution: 0.25,
      eligibleForMastery: false,
      correct: false,
    });
    expect(
      evaluateEvidence({
        mode: "evidence_bearing",
        verdict: "incorrect",
        score: 0,
        assistanceLevel: "independent",
        spacingSeconds: 24 * 60 * 60,
      }),
    ).toMatchObject({
      contribution: -0.6,
      eligibleForMastery: false,
      correct: false,
    });
    expect(
      evaluateEvidence({
        mode: "evidence_bearing",
        verdict: "uncertain",
        score: null,
        assistanceLevel: "independent",
        spacingSeconds: 24 * 60 * 60,
      }),
    ).toMatchObject({
      strength: "none",
      contribution: 0,
      eligibleForMastery: false,
    });
  });
});
