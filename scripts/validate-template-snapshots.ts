import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { readStoredObject } from "@/lib/storage/object-storage";
import { buildSampleAcademicDocument } from "@/lib/paper/template-conformance";
import { compileResourceLimits, safeCompilePath } from "@/lib/paper/compile-policy";
import { runCompileCommand, runCompilePipeline } from "@/lib/paper/compile-worker";
import { normalizeTemplateManifest } from "@/lib/paper/template-registry";
import { renderAcademicDocumentToLatex } from "@/lib/paper/latex-renderer";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function requestedVariants(): Set<string> | null {
  const value = process.env.TEMPLATE_VALIDATE_VARIANTS?.trim();
  return value ? new Set(value.split(",").map((item) => item.trim()).filter(Boolean)) : null;
}

function validationLimit(): number {
  const value = Number(process.env.TEMPLATE_VALIDATE_LIMIT ?? 12);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : 12;
}

function compileEngine(value: string | null | undefined): "xelatex" | "pdflatex" | "lualatex" {
  return value === "pdflatex" || value === "lualatex" ? value : "xelatex";
}

async function materializeArchive(directory: string, archiveBuffer: Buffer) {
  const archive = await JSZip.loadAsync(archiveBuffer);
  const files: Array<{ path: string; buffer: Buffer }> = [];
  for (const [rawPath, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const path = safeCompilePath(rawPath);
    if (["main.tex", "generated-content.tex", "references.bib"].includes(path)) continue;
    const buffer = await entry.async("nodebuffer");
    await mkdir(join(directory, path, ".."), { recursive: true });
    await writeFile(join(directory, path), buffer);
    files.push({ path, buffer });
  }
  return files;
}

async function validateVariant(row: { id: string; variantKey: string; manifest: unknown; pinnedUpstreamSnapshot: unknown; validation: unknown; sample: unknown }) {
  const snapshot = row.pinnedUpstreamSnapshot && typeof row.pinnedUpstreamSnapshot === "object" ? row.pinnedUpstreamSnapshot as Record<string, unknown> : {};
  const archive = snapshot.sourceArchive && typeof snapshot.sourceArchive === "object" ? snapshot.sourceArchive as Record<string, unknown> : null;
  const manifest = normalizeTemplateManifest(row.manifest);
  if (snapshot.materialized !== true || !archive || typeof archive.key !== "string" || (archive.provider !== "local" && archive.provider !== "qiniu")) {
    return { variantKey: row.variantKey, status: "skipped", reason: "未找到已物化的上游快照" };
  }
  const directory = await mkdtemp(join(tmpdir(), "lumenlab-template-"));
  try {
    const archiveBuffer = await readStoredObject({ provider: archive.provider, key: archive.key });
    const upstreamFiles = await materializeArchive(directory, archiveBuffer);
    const documentClass = typeof manifest.documentClass === "string" ? manifest.documentClass : null;
    if (!documentClass) throw new Error("Manifest 没有声明 documentClass，不能进行真实 Template Pack 编译");
    const document = buildSampleAcademicDocument();
    const rendered = renderAcademicDocumentToLatex(document, { manifest, references: [{ id: "ref-sample", title: "Sample Reference", authors: ["Author"], year: 2026, venue: "Journal", doi: null, url: null }], assetPaths: { "sample-figure": "assets/sample-figure.png" } });
    await mkdir(join(directory, "assets"), { recursive: true });
    await mkdir(join(directory, ".home"), { recursive: true });
    await mkdir(join(directory, ".tmp"), { recursive: true });
    await mkdir(join(directory, ".texmf-output"), { recursive: true });
    await writeFile(join(directory, "assets/sample-figure.png"), ONE_PIXEL_PNG);
    if (!upstreamFiles.some((file) => file.path === `${documentClass}.cls` || file.path.endsWith(`/${documentClass}.cls`))) {
      const installer = upstreamFiles.find((file) => file.path === `${documentClass}.ins` || file.path.endsWith(`/${documentClass}.ins`));
      if (!installer) throw new Error(`pinned snapshot 缺少 ${documentClass}.cls，且没有可执行的 ${documentClass}.ins`);
      const installerDirectory = dirname(installer.path) === "." ? "" : dirname(installer.path);
      const installerStem = basename(installer.path, ".ins");
      const bootstrapEntry = `${installerStem}.tex`;
      const installerPrefix = installerDirectory ? `${installerDirectory}/` : "";
      const installerDtx = upstreamFiles.filter((file) => file.path.startsWith(installerPrefix) && file.path.endsWith(".dtx"));
      const copiedDtx = installerDirectory ? installerDtx.map((file) => basename(file.path)) : [];
      for (const file of installerDtx) await writeFile(join(directory, basename(file.path)), file.buffer);
      await writeFile(join(directory, bootstrapEntry), `\\input{${installer.path}}\n`, "utf8");
      await runCompileCommand({ cwd: directory, command: { command: "xelatex", args: ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "-synctex=1", bootstrapEntry], phase: "engine" } });
      const generatedPath = join(directory, `${documentClass}.cls`);
      const generated = await readFile(generatedPath);
      if (installerDirectory) await writeFile(join(directory, `${documentClass}.cls`), generated);
      upstreamFiles.push({ path: `${documentClass}.cls`, buffer: generated });
      await rm(join(directory, bootstrapEntry), { force: true });
      for (const file of copiedDtx) await rm(join(directory, file), { force: true });
    }
    await writeFile(join(directory, "main.tex"), rendered.mainTex, "utf8");
    await writeFile(join(directory, "generated-content.tex"), rendered.generatedContentTex, "utf8");
    await writeFile(join(directory, "references.bib"), rendered.referencesBib, "utf8");
    const result = await runCompilePipeline({ cwd: directory, engine: compileEngine(manifest.engine), bibliography: manifest.bibliography });
    const pdf = await readFile(join(directory, "main.pdf"));
    if (pdf.byteLength === 0 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF 产物无效");
    const validation = row.validation && typeof row.validation === "object" && !Array.isArray(row.validation) ? row.validation as Record<string, unknown> : {};
    const cleanValidation = { ...validation };
    delete cleanValidation.sampleCompileError;
    await prisma.templateVariant.update({
      where: { id: row.id },
      data: {
        validation: JSON.parse(JSON.stringify({ ...cleanValidation, status: "Verified", sampleCompileAt: new Date().toISOString(), samplePdfSha256: createHash("sha256").update(pdf).digest("hex"), sourceFiles: upstreamFiles.length, compileEngine: compileEngine(manifest.engine), lastPhase: result.lastPhase })),
        sample: JSON.parse(JSON.stringify({ fixtureId: "sample-academic-v1", status: "verified" })),
      },
    });
    return { variantKey: row.variantKey, status: "Verified", files: upstreamFiles.length, pdfBytes: pdf.byteLength };
  } catch (error) {
    const validation = row.validation && typeof row.validation === "object" && !Array.isArray(row.validation) ? row.validation as Record<string, unknown> : {};
    await prisma.templateVariant.update({
      where: { id: row.id },
      data: {
        validation: JSON.parse(JSON.stringify({ ...validation, status: "Needs Review", sampleCompileAt: new Date().toISOString(), sampleCompileError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })),
        sample: JSON.parse(JSON.stringify({ fixtureId: "sample-academic-v1", status: "needs_review" })),
      },
    });
    return { variantKey: row.variantKey, status: "Needs Review", error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const requested = requestedVariants();
  const rows = await prisma.templateVariant.findMany({ select: { id: true, variantKey: true, manifest: true, pinnedUpstreamSnapshot: true, validation: true, sample: true }, orderBy: { variantKey: "asc" } });
  const candidates = rows.filter((row) => requested ? requested.has(row.variantKey) : Boolean((row.pinnedUpstreamSnapshot as Record<string, unknown> | null)?.materialized)).slice(0, requested ? rows.length : validationLimit());
  const results = [];
  for (const row of candidates) results.push(await validateVariant(row));
  console.log(JSON.stringify({ limits: compileResourceLimits(), selected: candidates.length, results }, null, 2));
  if (results.some((result) => result.status === "Needs Review")) process.exitCode = 1;
}

main().finally(async () => prisma.$disconnect());
