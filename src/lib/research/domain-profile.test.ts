import { describe, expect, it } from "vitest";
import { listResearchDomainProfiles, resolveResearchDomainProfile } from "./domain-profile";

function rank(profile: string[], provider: string): number {
  const index = profile.indexOf(provider);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

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

  it("general: sciverse is the first academic tier after project", () => {
    const providers = resolveResearchDomainProfile("general").preferredProviders;
    expect(providers[0]).toBe("project");
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "openalex"));
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "crossref"));
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "web"));
  });

  it("computer_science: sciverse/arxiv lead scholarly sources ahead of legacy metadata providers", () => {
    const providers = resolveResearchDomainProfile("computer_science").preferredProviders;
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "openalex"));
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "semantic_scholar"));
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "crossref"));
    expect(rank(providers, "arxiv")).toBeLessThan(rank(providers, "openalex"));
  });

  it("medicine: pubmed keeps domain authority with sciverse as primary scholarly retrieval", () => {
    const providers = resolveResearchDomainProfile("medicine").preferredProviders;
    expect(providers[0]).toBe("pubmed");
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "openalex"));
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "crossref"));
  });

  it("law: authoritative web/project outrank academic paper retrieval", () => {
    const providers = resolveResearchDomainProfile("law").preferredProviders;
    expect(rank(providers, "web")).toBeLessThan(rank(providers, "sciverse"));
    expect(rank(providers, "project")).toBeLessThan(rank(providers, "sciverse"));
    expect(rank(providers, "sciverse")).toBeLessThan(rank(providers, "openalex"));
  });
});
