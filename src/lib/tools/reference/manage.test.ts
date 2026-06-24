import { describe, expect, it } from "vitest";
import {
  formatReferenceEntry,
  formatReferenceInline,
} from "./manage";

describe("citation-manager formatting", () => {
  it("apa inline uses first author + year", () => {
    expect(
      formatReferenceInline("apa", ["Smith", "Bob"], 2023)
    ).toBe("(Smith, 2023)");
  });

  it("apa entry joins authors with &", () => {
    const entry = formatReferenceEntry("apa", {
      title: "Attention Is All You Need",
      authors: ["Vaswani", "Shazeer", "Parmar"],
      year: 2017,
      venue: "NeurIPS",
      url: null,
      doi: null,
      arxivId: null,
    });
    expect(entry).toContain("Vaswani, Shazeer, & Parmar");
    expect(entry).toContain("(2017)");
    expect(entry).toContain("NeurIPS");
  });

  it("ieee entry uses [1] marker", () => {
    const entry = formatReferenceEntry("ieee", {
      title: "BERT",
      authors: ["Devlin"],
      year: 2019,
      venue: "NAACL",
      url: null,
      doi: null,
      arxivId: null,
    });
    expect(entry.startsWith("[1]")).toBe(true);
  });

  it("gbt7714 inline uses bracket + year", () => {
    expect(formatReferenceInline("gbt7714", ["Zhang San"], 2022)).toBe(
      "[San, 2022]"
    );
  });

  it("harvard includes page when provided", () => {
    expect(
      formatReferenceInline("harvard", ["Brown"], 1999, "23")
    ).toBe("(Brown, 1999, p. 23)");
  });

  it("apa falls back to 'Anon' + n.d. when missing fields", () => {
    expect(
      formatReferenceEntry("apa", {
        title: "Mystery Paper",
        authors: [],
        year: null,
        venue: null,
        url: null,
        doi: null,
        arxivId: null,
      })
    ).toContain("(n.d.)");
    expect(
      formatReferenceEntry("apa", {
        title: "Mystery Paper",
        authors: [],
        year: null,
        venue: null,
        url: null,
        doi: null,
        arxivId: null,
      })
    ).toContain(" (n.d.).");
  });
});