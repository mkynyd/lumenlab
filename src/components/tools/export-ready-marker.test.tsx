import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExportReadyMarker } from "@/components/tools/export-ready-marker";

describe("ExportReadyMarker", () => {
  afterEach(() => {
    delete document.documentElement.dataset.exportReady;
  });

  it("marks the print document ready after fonts and content settle", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });

    render(<ExportReadyMarker />);

    await waitFor(() => {
      expect(document.documentElement.dataset.exportReady).toBe("true");
    });
  });
});
