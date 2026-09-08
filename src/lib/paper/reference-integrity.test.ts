import { describe, expect, it } from "vitest";
import { collectDocumentReferenceIds, findMissingDocumentReferenceIds } from "./reference-integrity";

describe("paper reference integrity", () => {
  it("collects citations from nested inline nodes, lists and bibliography blocks once", () => {
    const document = {
      blocks: [
        { children: [{ kind: "bold", children: [{ kind: "citation", referenceId: "ref-a" }] }] },
        { items: [[{ kind: "footnote", children: [{ kind: "citation", referenceId: "ref-b" }] }]] },
        { referenceIds: ["ref-a", "ref-c", ""] },
      ],
    };
    expect(collectDocumentReferenceIds(document)).toEqual(["ref-a", "ref-b", "ref-c"]);
  });

  it("reports only references not owned by the current Paper Workspace", () => {
    expect(findMissingDocumentReferenceIds({ blocks: [{ referenceIds: ["ref-a", "ref-b"] }] }, ["ref-a"])).toEqual(["ref-b"]);
  });
});
