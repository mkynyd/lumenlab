import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderAcademicDocumentToLatex } from "./latex-renderer";
import { buildGeneralAcademicTemplateManifest } from "./template-registry";
import { buildSampleAcademicDocument } from "./template-conformance";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function executableAvailable(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["-v"], { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

function runLatexmk(cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("latexmk", ["-xelatex", "-bibtex", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "main.tex"], { cwd, shell: false, stdio: "pipe" });
    const output: string[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`latexmk timeout: ${output.join("").slice(-2_000)}`));
    }, 90_000);
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`latexmk exited ${code}: ${output.join("").slice(-4_000)}`));
    });
  });
}

describe("real academic template compile", () => {
  it("compiles the shared sample with XeLaTeX, BibTeX, Chinese text and an asset when TeX Live is available", async () => {
    if (!(await executableAvailable("latexmk"))) return;
    const directory = await mkdtemp(join(tmpdir(), "lumenlab-paper-real-test-"));
    try {
      const rendered = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
        manifest: buildGeneralAcademicTemplateManifest(),
        references: [{ id: "ref-sample", title: "Sample Reference", authors: ["Author"], year: 2026, venue: "Journal", doi: null, url: null }],
        assetPaths: { "sample-figure": "assets/sample-figure.png" },
      });
      await writeFile(join(directory, "main.tex"), rendered.mainTex);
      await writeFile(join(directory, "generated-content.tex"), rendered.generatedContentTex);
      await writeFile(join(directory, "references.bib"), rendered.referencesBib);
      await mkdir(join(directory, "assets"), { recursive: true });
      await writeFile(join(directory, "assets", "sample-figure.png"), ONE_PIXEL_PNG);
      await runLatexmk(directory);
      const pdf = await readFile(join(directory, "main.pdf"));
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
