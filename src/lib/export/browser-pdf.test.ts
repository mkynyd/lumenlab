// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  newContext: vi.fn(),
  newPage: vi.fn(),
  goto: vi.fn(),
  waitForFunction: vi.fn(),
  pdf: vi.fn(),
  close: vi.fn(),
}));

vi.mock("playwright-core", () => ({
  chromium: { launch: mocks.launch },
}));

import { renderMarkdownPdf } from "@/lib/export/browser-pdf";

describe("renderMarkdownPdf", () => {
  const originalExecutablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHROMIUM_EXECUTABLE_PATH = "/mock/chromium";
    mocks.launch.mockResolvedValue({
      newContext: mocks.newContext,
      close: mocks.close,
    });
    mocks.newContext.mockResolvedValue({ newPage: mocks.newPage });
    mocks.newPage.mockResolvedValue({
      goto: mocks.goto,
      waitForFunction: mocks.waitForFunction,
      pdf: mocks.pdf,
    });
    mocks.pdf.mockResolvedValue(Buffer.from("%PDF-test"));
  });

  afterEach(() => {
    if (originalExecutablePath === undefined) {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
    } else {
      process.env.CHROMIUM_EXECUTABLE_PATH = originalExecutablePath;
    }
  });

  it("prints the authenticated conversion view after all content is ready", async () => {
    const result = await renderMarkdownPdf({
      requestUrl: "http://localhost:3000/api/tools/conversions/conversion-1/download",
      conversionId: "conversion-1",
      cookieHeader: "session=secret",
    });

    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: "/mock/chromium", headless: true })
    );
    expect(mocks.newContext).toHaveBeenCalledWith({
      extraHTTPHeaders: { cookie: "session=secret" },
    });
    expect(mocks.goto).toHaveBeenCalledWith(
      "http://localhost:3000/tools/conversion-1?print=1",
      { waitUntil: "networkidle", timeout: 60_000 }
    );
    expect(mocks.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      undefined,
      { timeout: 60_000 }
    );
    expect(mocks.pdf).toHaveBeenCalledWith({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" },
    });
    expect(result.subarray(0, 4).toString()).toBe("%PDF");
    expect(mocks.close).toHaveBeenCalled();
  });

  it("always closes Chromium when printing fails", async () => {
    mocks.goto.mockRejectedValue(new Error("navigation failed"));

    await expect(
      renderMarkdownPdf({
        requestUrl: "http://localhost:3000/api/tools/conversions/conversion-1/download",
        conversionId: "conversion-1",
        cookieHeader: "session=secret",
      })
    ).rejects.toThrow("navigation failed");
    expect(mocks.close).toHaveBeenCalled();
  });
});
