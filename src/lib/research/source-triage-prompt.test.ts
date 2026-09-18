import { describe, expect, it } from "vitest";
import type { ResearchPlanSnapshot } from "./contracts";
import type { ResearchCandidate } from "./source-provider";
import {
  buildSourceTriagePrompt,
  SOURCE_TRIAGE_CANDIDATE_CHAR_BUDGET,
  SOURCE_TRIAGE_MIN_EXCERPT_CHARS,
} from "./prompts";

const plan = { schemaVersion: "1", researchGoal: "g", scope: "s", timeRange: null, researchQuestions: [], sourceStrategy: [], completionCriteria: [], expectedOutputs: [], researchIntensity: "deep", domainProfileKey: "general" } as unknown as ResearchPlanSnapshot;

const strategy = { query: "q", purpose: "primary_work", sourceRole: "primary", freshness: "any", questionKey: "q1" } as const;

function candidate(id: string, abstractLength: number): { id: string; candidate: ResearchCandidate } {
  return {
    id,
    candidate: {
      provider: "sciverse",
      kind: "academic_paper",
      externalId: `ext-${id}`,
      title: `paper ${id}`,
      url: null,
      metadata: { abstractPreview: `${id}-`.padEnd(abstractLength, "x") },
    },
  };
}

function abstractsInPrompt(prompt: string): string[] {
  const candidatesLine = prompt.split("\n").find((line) => line.startsWith("候选："))!;
  const payload = JSON.parse(candidatesLine.slice("候选：".length)) as Array<{ id: string; abstractPreview: string | null }>;
  return payload.map((item) => item.abstractPreview ?? "");
}

describe("buildSourceTriagePrompt · candidate excerpt budget", () => {
  it("keeps the historical 800-char excerpt cap for twelve candidates by default", () => {
    const prompt = buildSourceTriagePrompt({
      plan,
      question: "question",
      strategy,
      candidates: Array.from({ length: 12 }, (_, index) => candidate(String(index), 2_000)),
    });
    const abstracts = abstractsInPrompt(prompt);
    expect(abstracts).toHaveLength(12);
    for (const abstract of abstracts) expect(abstract).toHaveLength(800);
  });

  it("slices candidates beyond twelve", () => {
    const prompt = buildSourceTriagePrompt({
      plan,
      question: "question",
      strategy,
      candidates: Array.from({ length: 15 }, (_, index) => candidate(String(index), 100)),
    });
    expect(abstractsInPrompt(prompt)).toHaveLength(12);
  });

  it("shrinks per-candidate excerpts when the char budget is tightened", () => {
    const prompt = buildSourceTriagePrompt({
      plan,
      question: "question",
      strategy,
      candidates: Array.from({ length: 12 }, (_, index) => candidate(String(index), 2_000)),
      candidateCharBudget: 2_400,
    });
    // 2_400 / 12 = 200 → 被下限托底到 240，单候选仍远小于默认 800。
    const abstracts = abstractsInPrompt(prompt);
    for (const abstract of abstracts) expect(abstract).toHaveLength(SOURCE_TRIAGE_MIN_EXCERPT_CHARS);
  });

  it("respects the exported default budget constant", () => {
    const prompt = buildSourceTriagePrompt({
      plan,
      question: "question",
      strategy,
      candidates: Array.from({ length: 8 }, (_, index) => candidate(String(index), 5_000)),
    });
    // 8 条候选均分 9_600 预算 = 1_200/条，高于历史 800 上限时仍按 800 截断。
    const abstracts = abstractsInPrompt(prompt);
    for (const abstract of abstracts) expect(abstract).toHaveLength(800);
    expect(SOURCE_TRIAGE_CANDIDATE_CHAR_BUDGET).toBe(9_600);
  });
});
