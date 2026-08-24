import { describe, expect, it } from "vitest";
import { appendVerificationQualification, selectVerificationRepairTargets, verificationRepairInstruction } from "./verification-repair";

const question = { id: "question-1", title: "核心问题", question: "核心研究问题", priority: "critical" as const };

describe("verification repair planning", () => {
  it("deduplicates failed claims by question and prioritizes critical gaps", () => {
    const targets = selectVerificationRepairTargets({
      claims: [
        { id: "claim-important", questionId: "question-2", question: { ...question, id: "question-2", priority: "important" } },
        { id: "claim-critical-a", questionId: question.id, question },
        { id: "claim-critical-b", questionId: question.id, question },
      ],
      statuses: {
        "claim-important": { status: "unsupported" },
        "claim-critical-a": { status: "conflicted" },
        "claim-critical-b": { status: "unsupported" },
      },
      maximum: 1,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ questionId: question.id, claimIds: ["claim-critical-a", "claim-critical-b"], statuses: ["conflicted", "unsupported"] });
    expect(verificationRepairInstruction(targets[0])).toContain("独立来源");
  });

  it("keeps a deterministic qualification note when no repair budget remains", () => {
    expect(appendVerificationQualification({ draft: "## 结论\n\n草稿", unsupportedClaims: 1, conflictedClaims: 1, qualifiedClaims: 0 }))
      .toContain("引用核验限制");
  });
});
