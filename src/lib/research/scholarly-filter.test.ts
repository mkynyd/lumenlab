// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deriveScholarlyFilterIntent, parsePlanTimeRange } from "./scholarly-filter";

describe("plan time range parsing", () => {
  it("parses a year span into inclusive bounds", () => {
    expect(parsePlanTimeRange("2024-2026")).toEqual({ yearFrom: 2024, yearTo: 2026 });
    expect(parsePlanTimeRange("2024 至 2026 年")).toEqual({ yearFrom: 2024, yearTo: 2026 });
  });

  it("treats a single year as an exact bound unless an open-ended marker is present", () => {
    expect(parsePlanTimeRange("2024")).toEqual({ yearFrom: 2024, yearTo: 2024 });
    expect(parsePlanTimeRange("2023 年以来")).toEqual({ yearFrom: 2023 });
    expect(parsePlanTimeRange("since 2020")).toEqual({ yearFrom: 2020 });
  });

  it("returns no bounds when nothing deterministic can be parsed", () => {
    expect(parsePlanTimeRange(null)).toEqual({});
    expect(parsePlanTimeRange("近三年")).toEqual({});
    expect(parsePlanTimeRange("")).toEqual({});
  });
});

describe("scholarly filter intent derivation", () => {
  const base = { domainProfileKey: "general", budgetProfile: "deep" as const };

  it("returns null when the question carries no structured signal", () => {
    expect(deriveScholarlyFilterIntent({ ...base, question: "How do MoE routers balance expert load?" })).toBeNull();
  });

  it("maps an explicit survey request to a review type filter", () => {
    const derived = deriveScholarlyFilterIntent({ ...base, question: "Summarize the systematic review of MoE routing" });
    expect(derived?.intent).toEqual({ publicationTypes: ["review"] });
    expect(derived?.signals).toContain("review_requested");
  });

  it("maps open-access and venue wording to their intent keys", () => {
    expect(deriveScholarlyFilterIntent({ ...base, question: "open access journal article on routing" })?.intent).toEqual({
      openAccess: true,
      venueTypes: ["journal"],
    });
    expect(deriveScholarlyFilterIntent({ ...base, question: "comparing conference papers on routing" })?.intent).toEqual({
      venueTypes: ["conference"],
    });
  });

  it("maps influence wording to the catalog's citation percentile band", () => {
    const derived = deriveScholarlyFilterIntent({ ...base, question: "What are the seminal papers on expert routing?" });
    expect(derived?.intent).toEqual({ topPercentile: "top_10_percent" });
  });

  it("carries the plan time range as typed basic filters", () => {
    const derived = deriveScholarlyFilterIntent({ ...base, question: "routing progress", planTimeRange: "2024–2026" });
    expect(derived).toMatchObject({ yearFrom: 2024, yearTo: 2026 });
    expect(derived?.signals).toContain("plan_time_range");
  });

  it("applies the medicine clinical signal but not for law", () => {
    const question = "Which randomized clinical trial supports this guideline?";
    expect(deriveScholarlyFilterIntent({ ...base, domainProfileKey: "medicine", question })?.intent).toEqual({
      publicationTypes: ["clinical-trial"],
    });
    // 同为医学信号词，但在法域 profile 下不施加学术类型收敛。
    expect(deriveScholarlyFilterIntent({ ...base, domainProfileKey: "law", question })).toBeNull();
  });

  it("never hardcodes a language constraint, and never lets a domain lock recall", () => {
    const derived = deriveScholarlyFilterIntent({ ...base, domainProfileKey: "computer_science", question: "How does MoE routing work?" });
    expect(derived).toBeNull();
  });

  it("uses the law profile to skip scholarly-only signals while keeping explicit requests", () => {
    expect(deriveScholarlyFilterIntent({ ...base, domainProfileKey: "law", question: "preprint on statutory interpretation" })).toBeNull();
    expect(deriveScholarlyFilterIntent({ ...base, domainProfileKey: "law", question: "open access article on statutory interpretation" })?.intent)
      .toEqual({ openAccess: true });
  });

  it("returns null for an empty question", () => {
    expect(deriveScholarlyFilterIntent({ ...base, question: "   " })).toBeNull();
  });
});
