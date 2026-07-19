import { existsSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";
import sharp from "sharp";

import { chromiumExecutablePath } from "@/lib/export/browser-pdf";

/** Render Mermaid in an isolated local Chromium page for DOCX media only. */
export async function renderMermaidPng(code: string): Promise<Buffer> {
  const mermaidScript = path.join(
    process.cwd(),
    "node_modules",
    "mermaid",
    "dist",
    "mermaid.min.js"
  );
  if (!existsSync(mermaidScript)) {
    throw new Error("未找到 Mermaid 渲染器，无法生成 DOCX 图表。");
  }

  const browser = await chromium.launch({
    executablePath: chromiumExecutablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.setContent('<main id="diagram" style="padding:24px;background:#fff"></main>');
    await page.addScriptTag({ path: mermaidScript });
    const svg = await page.evaluate(async (definition) => {
      const mermaid = (window as unknown as {
        mermaid?: {
          initialize: (config: Record<string, unknown>) => void;
          render: (id: string, source: string) => Promise<{ svg: string }>;
        };
      }).mermaid;
      if (!mermaid) throw new Error("Mermaid 浏览器脚本未加载");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          primaryColor: "#ffffff",
          primaryBorderColor: "#2563eb",
          primaryTextColor: "#111827",
          lineColor: "#2563eb",
          fontFamily: "Arial, Noto Sans SC, sans-serif",
        },
      });
      const rendered = await mermaid.render("lumenlab-docx-mermaid", definition);
      return rendered.svg;
    }, code);
    return sharp(Buffer.from(svg)).png().toBuffer();
  } finally {
    await browser.close();
  }
}
