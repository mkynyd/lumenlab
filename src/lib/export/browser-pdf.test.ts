// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  newContext: vi.fn(),
  route: vi.fn(),
  newPage: vi.fn(),
  goto: vi.fn(),
  waitForFunction: vi.fn(),
  pdf: vi.fn(),
  close: vi.fn(),
  abort: vi.fn(),
  continue: vi.fn(),
}));

vi.mock("playwright-core", () => ({
  chromium: { launch: mocks.launch },
}));

import { renderMarkdownPdf } from "@/lib/export/browser-pdf";

describe("renderMarkdownPdf", () => {
  const originalExecutablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  const originalAppOrigin = process.env.LUMENLAB_APP_ORIGIN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHROMIUM_EXECUTABLE_PATH = "/mock/chromium";
    process.env.LUMENLAB_APP_ORIGIN = "http://localhost:3000";
    mocks.launch.mockResolvedValue({
      newContext: mocks.newContext,
      close: mocks.close,
    });
    mocks.newContext.mockResolvedValue({ newPage: mocks.newPage, route: mocks.route });
    mocks.goto.mockResolvedValue(undefined);
    mocks.waitForFunction.mockResolvedValue(undefined);
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
    if (originalAppOrigin === undefined) {
      delete process.env.LUMENLAB_APP_ORIGIN;
    } else {
      process.env.LUMENLAB_APP_ORIGIN = originalAppOrigin;
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
    expect(mocks.route).toHaveBeenCalledWith("**/*", expect.any(Function));
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

  it("keeps the authenticated print browser on the configured application origin", async () => {
    await renderMarkdownPdf({
      requestUrl: "http://untrusted.example/api/tools/conversions/conversion-1/download",
      conversionId: "conversion-1",
      cookieHeader: "session=secret",
    });
    const routeHandler = mocks.route.mock.calls[0][1] as (route: {
      request: () => { url: () => string };
      abort: (reason: string) => Promise<void>;
      continue: () => Promise<void>;
    }) => Promise<void>;

    await routeHandler({
      request: () => ({ url: () => "http://169.254.169.254/latest/meta-data" }),
      abort: mocks.abort,
      continue: mocks.continue,
    });

    expect(mocks.goto).toHaveBeenCalledWith(
      "http://localhost:3000/tools/conversion-1?print=1",
      { waitUntil: "networkidle", timeout: 60_000 }
    );
    expect(mocks.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(mocks.continue).not.toHaveBeenCalled();
  });
});
