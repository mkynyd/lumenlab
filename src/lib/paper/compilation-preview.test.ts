import { describe, expect, it } from "vitest";
import { selectCompilationPreview } from "./compilation-preview";

const succeeded = {
  id: "compile-success",
  status: "succeeded",
  pdfStorageProvider: "local",
  pdfObjectKey: "papers/previous/main.pdf",
  syncTex: { provider: "local", key: "papers/previous/main.synctex.gz", format: "synctex.gz" },
};

describe("paper compilation preview", () => {
  it("keeps the last successful PDF while the latest job is queued", () => {
    expect(selectCompilationPreview({ id: "compile-queued", status: "queued" }, succeeded)).toEqual({
      pdfCompilationId: "compile-success",
      syncTex: succeeded.syncTex,
    });
  });

  it("uses the latest successful job when no separate fallback exists", () => {
    expect(selectCompilationPreview(succeeded, null).pdfCompilationId).toBe("compile-success");
  });

  it("does not expose a partial or failed artifact as a PDF", () => {
    expect(selectCompilationPreview({ id: "compile-failed", status: "failed", pdfObjectKey: "main.pdf", pdfStorageProvider: "local" }, null)).toEqual({ pdfCompilationId: null, syncTex: null });
  });
});
