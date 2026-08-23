import { describe, expect, it } from "vitest";
import { parseBibTeX } from "./reference-import";

describe("paper reference imports", () => {
  it("parses multiple BibTeX entries deterministically", () => {
    const references = parseBibTeX(`@article{one, title={A study}, author={Smith, Jane and Doe, John}, year={2024}, journal={Journal A}, doi={10.1234/ABC}}\n@inproceedings{two, title="Another study", author="Lee", year="2023", booktitle="Conf B"}`);
    expect(references).toHaveLength(2);
    expect(references[0]).toMatchObject({ title: "A study", doi: "10.1234/abc", year: 2024, venue: "Journal A" });
    expect(references[0].authors).toEqual(["Smith, Jane", "Doe, John"]);
    expect(references[1]).toMatchObject({ title: "Another study", year: 2023, venue: "Conf B" });
  });
});
