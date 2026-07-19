import { existsSync } from "fs";
import { chromium } from "playwright-core";

export function chromiumExecutablePath() {
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

function applicationOrigin() {
  const configured =
    process.env.LUMENLAB_APP_ORIGIN ||
    process.env.NEXTAUTH_URL ||
    process.env.AUTH_URL;
  if (configured) {
    try {
      const origin = new URL(configured).origin;
      if (origin.startsWith("http://") || origin.startsWith("https://")) return origin;
    } catch {
      throw new Error("LUMENLAB_APP_ORIGIN 必须是合法的 HTTP(S) 地址");
    }
  }
  return `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

export interface AuthenticatedPrintPdfInput {
  cookieHeader: string;
  printPath: string;
  surfaceSelector: string;
}

export async function renderAuthenticatedPrintPdf(input: AuthenticatedPrintPdfInput) {
  const browser = await chromium.launch({
    executablePath: chromiumExecutablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      extraHTTPHeaders: { cookie: input.cookieHeader },
    });
    const trustedOrigin = applicationOrigin();
    await context.route("**/*", async (route) => {
      const resourceUrl = new URL(route.request().url());
      if (resourceUrl.origin !== trustedOrigin) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    const printUrl = new URL(input.printPath, trustedOrigin);
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
      const diagnostic = await page.evaluate(
        (surfaceSelector) => ({
          url: window.location.href,
          title: document.title,
          ready: document.documentElement.dataset.exportReady || null,
          images: document.images.length,
          completedImages: Array.from(document.images).filter(
            (image) => image.complete
          ).length,
          pendingRenderers: document.querySelectorAll(
            '[data-render-state="pending"]'
          ).length,
          hasPrintSurface: Boolean(document.querySelector(surfaceSelector)),
        }),
        input.surfaceSelector
      );
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

export async function renderMarkdownPdf(input: {
  requestUrl: string;
  conversionId: string;
  cookieHeader: string;
}) {
  return renderAuthenticatedPrintPdf({
    cookieHeader: input.cookieHeader,
    printPath: `/tools/${encodeURIComponent(input.conversionId)}?print=1`,
    surfaceSelector: "[data-conversion-print]",
  });
}

export async function renderArtifactPdf(input: {
  requestUrl: string;
  artifactId: string;
  cookieHeader: string;
}) {
  return renderAuthenticatedPrintPdf({
    cookieHeader: input.cookieHeader,
    printPath: `/artifacts/${encodeURIComponent(input.artifactId)}/print`,
    surfaceSelector: "[data-artifact-print]",
  });
}
