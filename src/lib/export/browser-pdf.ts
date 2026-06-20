import { existsSync } from "fs";
import { chromium } from "playwright-core";

function chromiumExecutablePath() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const executablePath = candidates.find(existsSync);
  if (!executablePath) {
    throw new Error("未找到 Chromium，请配置 CHROMIUM_EXECUTABLE_PATH");
  }
  return executablePath;
}

export async function renderMarkdownPdf(input: {
  requestUrl: string;
  conversionId: string;
  cookieHeader: string;
}) {
  const browser = await chromium.launch({
    executablePath: chromiumExecutablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      extraHTTPHeaders: { cookie: input.cookieHeader },
    });
    const page = await context.newPage();
    const printUrl = new URL(
      `/tools/${encodeURIComponent(input.conversionId)}?print=1`,
      input.requestUrl
    );
    await page.goto(printUrl.toString(), {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    try {
      await page.waitForFunction(
        () => document.documentElement.dataset.exportReady === "true",
        undefined,
        { timeout: 60_000 }
      );
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        ready: document.documentElement.dataset.exportReady || null,
        images: document.images.length,
        completedImages: Array.from(document.images).filter(
          (image) => image.complete
        ).length,
        pendingMermaid: document.querySelectorAll(
          '[data-render-state="pending"]'
        ).length,
        hasPrintSurface: Boolean(
          document.querySelector("[data-conversion-print]")
        ),
      }));
      throw new Error(
        `打印页未就绪：${JSON.stringify(diagnostic)}`,
        { cause: error }
      );
    }
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
