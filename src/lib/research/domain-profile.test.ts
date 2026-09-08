import { describe, expect, it } from "vitest";
import { listResearchDomainProfiles, resolveResearchDomainProfile } from "./domain-profile";

describe("research domain profiles", () => {
  it("provides explicit source, evidence and citation rules", () => {
    const medicine = resolveResearchDomainProfile("medicine");
    expect(medicine.preferredProviders).toContain("pubmed");
    expect(medicine.evidenceStandards.length).toBeGreaterThan(0);
    expect(medicine.citationRules.join(" ")).toContain("个体医疗建议");
  });

  it("falls back safely and exposes the supported profile catalog", () => {
    expect(resolveResearchDomainProfile("unknown").key).toBe("general");
    expect(listResearchDomainProfiles().map((profile) => profile.key)).toEqual(["general", "computer_science", "medicine", "law"]);
  });
});
