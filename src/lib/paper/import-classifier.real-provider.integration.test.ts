// @vitest-environment node

import { describe, expect, it } from "vitest";
import { classifyAmbiguousPaperImport } from "./import-classifier";
import type { AcademicDocument } from "./document-schema";

const enabled =
  process.env.PAPER_CLASSIFIER_E2E === "1" &&
  Boolean(process.env.RESEARCH_E2E_USER_ID);

describe("real Paper DOCX classification", () => {
  it.runIf(enabled)("classifies an ambiguous DOCX drawing with the active model", async () => {
    const document: AcademicDocument = {
      schemaVersion: "1",
      title: "DOCX import classification E2E",
      blocks: [
        {
          kind: "paper_metadata",
          title: "DOCX import classification E2E",
          authors: ["Test Author"],
        },
        {
          kind: "raw_latex",
          id: "docx-ambiguous-drawing-1",
          latex:
            '<w:drawing><wp:docPr name="Figure 1" descr="System architecture diagram"/><a:blip r:embed="rId5"/></w:drawing>',
        },
      ],
    };

    const result = await classifyAmbiguousPaperImport({
      userId: process.env.RESEARCH_E2E_USER_ID!,
      sourceType: "docx",
      document,
      lowConfidenceBlocks: [
        {
          index: 1,
          reason:
            "DOCX drawing XML and image relationship require structure confirmation",
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.model).toBe("deepseek-v4-flash-vision-exp");
    expect(result.suggestions).toEqual([
      expect.objectContaining({ index: 1, kind: "figure" }),
    ]);
    console.log(JSON.stringify({
      status: result.status,
      model: result.model,
      suggestion: result.suggestions[0]?.kind ?? null,
    }));
  }, 60_000);
});
