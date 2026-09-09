import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocument = vi.hoisted(() => vi.fn());

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument,
  GlobalWorkerOptions: { workerSrc: "" },
}));

import { PaperPdfViewer } from "./paper-pdf-viewer";

describe("PaperPdfViewer", () => {
  beforeEach(() => {
    getDocument.mockReset();
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 0, destroy: vi.fn() }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response));
  });

  it("passes pdf.js the CMap and standard-font tables so CJK glyphs render", async () => {
    render(<PaperPdfViewer pdfUrl="/api/papers/compilations/c1/pdf" />);

    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
    }));
  });
});
