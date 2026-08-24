import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { activeStorageProvider, readStoredObject, uploadObjectBuffer, type StoredObjectRef } from "@/lib/storage/object-storage";
import { buildSampleAcademicDocument } from "@/lib/paper/template-conformance";
import { compileResourceLimits, safeCompilePath } from "@/lib/paper/compile-policy";
import { runCompileCommand, runCompilePipeline } from "@/lib/paper/compile-worker";
import { normalizeTemplateManifest, readTemplateSamplePdf, templateSampleObjectKey } from "@/lib/paper/template-registry";
import { renderAcademicDocumentToLatex } from "@/lib/paper/latex-renderer";
import { buildDtxBootstrapPlan, findTemplateInstaller, isLatexTemplateFormat, isSystemDocumentClass, normalizeTemplateRuntimeBuffer, resolveTemplateBibliography, resolveTemplateDocumentClass } from "@/lib/paper/template-snapshot";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const GENERATED_TEMPLATE_PATHS = new Set(["main.tex", "generated-content.tex", "references.bib"]);

async function uploadOrReuseSamplePdf(variantKey: string, pdf: Buffer, sha256: string): Promise<StoredObjectRef> {
  const key = templateSampleObjectKey(variantKey, sha256);
  try {
    return await uploadObjectBuffer({ key, mimeType: "application/pdf", buffer: pdf });
  } catch (error) {
    if (!/614/.test(error instanceof Error ? error.message : String(error))) throw error;
    const existing = { provider: activeStorageProvider(), key } satisfies StoredObjectRef;
    const stored = await readStoredObject(existing);
    const actualHash = createHash("sha256").update(stored).digest("hex");
    if (actualHash !== sha256) throw new Error(`模板 Sample PDF 已存在但校验和不匹配：${key}`);
    return existing;
  }
}

function requestedVariants(): Set<string> | null {
  const value = process.env.TEMPLATE_VALIDATE_VARIANTS?.trim();
  return value ? new Set(value.split(",").map((item) => item.trim()).filter(Boolean)) : null;
}

function validationLimit(): number {
  const value = Number(process.env.TEMPLATE_VALIDATE_LIMIT ?? 12);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 1_000) : 12;
}

function compileEngine(value: string | null | undefined): "xelatex" | "pdflatex" | "lualatex" {
  return value === "pdflatex" || value === "lualatex" ? value : "xelatex";
}

function normalizeValidationFailure(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const contextAfter = (marker: string): string => {
    const index = raw.lastIndexOf(marker);
    if (index < 0) return "";
    return raw.slice(index, index + 420).replace(/\s+/g, " ").trim();
  };
  const patterns: Array<[string, RegExp]> = [
    ["TEMPLATE_CLASS_ERROR", /Class\s+[A-Za-z0-9_-]+\s+Error:\s*([^\n]+)/i],
    ["FONT_MISSING", /Package\s+fontspec\s+Error:\s*([^\n]+)/i],
    ["TEMPLATE_PACKAGE_ERROR", /Package\s+([^\s]+)\s+Error:\s*([^\n]+)/i],
    ["UNDEFINED_CONTROL_SEQUENCE", /(?:!\s*)?Undefined control sequence\.?/i],
    ["PREAMBLE_ONLY_COMMAND", /LaTeX\s+Error:\s*Can be used only in preamble\.?/i],
    ["LATEX_ERROR", /LaTeX\s+Error:\s*([^\n]+)/i],
    ["MISSING_FILE", /File\s+[`']([^`']+)[`']\s+not found/i],
    ["MISSING_DOCUMENT_CLASS", /(?:Manifest 没有声明|pinned snapshot 缺少)([^\n]+)/i],
    ["BIBLIOGRAPHY_BACKEND_UNAVAILABLE", /(?:usage:\s*lipo|Could not open biber log file)/i],
  ];
  for (const [code, pattern] of patterns) {
    const match = raw.match(pattern);
    if (match) {
      const detail = code === "UNDEFINED_CONTROL_SEQUENCE"
        ? contextAfter("Undefined control sequence.")
        : code === "PREAMBLE_ONLY_COMMAND"
          ? contextAfter("Can be used only in preamble")
          : code === "BIBLIOGRAPHY_BACKEND_UNAVAILABLE"
            ? "本机 Biber 后端不可用；需在编译 Worker 镜像中提供可执行的 biber"
          : match.slice(1).filter(Boolean).join(" — ").trim();
      return { code, message: `${code}: ${detail}`.slice(0, 500) };
    }
  }
  const diagnostic = [...raw.matchAll(/(?:^|\n)(?:[^\n]*?:\d+:\s*)([^\n]+)/g)].at(-1)?.[1]?.trim();
  const fallback = diagnostic || raw.split("\n").filter(Boolean).at(-1) || raw;
  const context = raw.slice(-720).replace(/\s+/g, " ").trim();
  return { code: "COMPILE_FAILED", message: `${fallback}${context && context !== fallback ? ` | ${context}` : ""}`.slice(0, 500) };
}

async function materializeArchive(directory: string, archiveBuffer: Buffer) {
  const archive = await JSZip.loadAsync(archiveBuffer);
  const files: Array<{ path: string; buffer: Buffer }> = [];
  for (const [rawPath, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const path = safeCompilePath(rawPath);
    const buffer = normalizeTemplateRuntimeBuffer(path, await entry.async("nodebuffer"));
    if (!GENERATED_TEMPLATE_PATHS.has(path)) {
      await mkdir(join(directory, dirname(path)), { recursive: true });
      await writeFile(join(directory, path), buffer);
    }
    files.push({ path, buffer });
  }
  return files;
}

async function validateVariant(row: { id: string; variantKey: string; manifest: unknown; pinnedUpstreamSnapshot: unknown; validation: unknown; sample: unknown }) {
  const snapshot = row.pinnedUpstreamSnapshot && typeof row.pinnedUpstreamSnapshot === "object" ? row.pinnedUpstreamSnapshot as Record<string, unknown> : {};
  const archive = snapshot.sourceArchive && typeof snapshot.sourceArchive === "object" ? snapshot.sourceArchive as Record<string, unknown> : null;
  const manifest = normalizeTemplateManifest(row.manifest);
  if (!isLatexTemplateFormat(manifest.format)) {
    return { variantKey: row.variantKey, status: "skipped", reason: `非 LaTeX Template Pack：${manifest.format}` };
  }
  if (snapshot.materialized !== true || !archive || typeof archive.key !== "string" || (archive.provider !== "local" && archive.provider !== "qiniu")) {
    return { variantKey: row.variantKey, status: "skipped", reason: "未找到已物化的上游快照" };
  }
  const directory = await mkdtemp(join(tmpdir(), "lumenlab-template-"));
  try {
    const archiveBuffer = await readStoredObject({ provider: archive.provider, key: archive.key });
    const upstreamFiles = await materializeArchive(directory, archiveBuffer);
    const documentClass = resolveTemplateDocumentClass(manifest, upstreamFiles);
    if (!documentClass) throw new Error("Manifest 没有声明 documentClass，不能进行真实 Template Pack 编译");
    const effectiveManifest = documentClass !== manifest.documentClass ? { ...manifest, documentClass } : manifest;
    const compileManifest = resolveTemplateBibliography(effectiveManifest, upstreamFiles);
    const nestedClass = upstreamFiles.find((file) => file.path.endsWith(`/${documentClass}.cls`));
    if (nestedClass && !upstreamFiles.some((file) => file.path === `${documentClass}.cls`)) {
      await writeFile(join(directory, `${documentClass}.cls`), nestedClass.buffer);
      upstreamFiles.push({ path: `${documentClass}.cls`, buffer: nestedClass.buffer });
    }
    const document = buildSampleAcademicDocument();
    const rendered = renderAcademicDocumentToLatex(document, { manifest: compileManifest, references: [{ id: "ref-sample", title: "Sample Reference", authors: ["Author"], year: 2026, venue: "Journal", doi: null, url: null }], assetPaths: { "sample-figure": "assets/sample-figure.png" }, templateFiles: upstreamFiles });
    await mkdir(join(directory, "assets"), { recursive: true });
    await mkdir(join(directory, ".home"), { recursive: true });
    await mkdir(join(directory, ".tmp"), { recursive: true });
    await mkdir(join(directory, ".texmf-output"), { recursive: true });
    await writeFile(join(directory, "assets/sample-figure.png"), ONE_PIXEL_PNG);
    if (!isSystemDocumentClass(documentClass) && !upstreamFiles.some((file) => file.path === `${documentClass}.cls` || file.path.endsWith(`/${documentClass}.cls`))) {
      const installer = findTemplateInstaller(documentClass, upstreamFiles);
      if (installer) {
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
      } else {
        const dtx = upstreamFiles.find((file) => file.path.endsWith(`/${documentClass}.dtx`) || file.path === `${documentClass}.dtx` || file.buffer.toString("utf8").match(new RegExp(`\\\\Provides(?:Expl)?Class\\s*\\{${documentClass}\\}`, "i")));
        if (!dtx) throw new Error(`pinned snapshot 缺少 ${documentClass}.cls，且没有可执行的 class source`);
        const dtxName = basename(dtx.path);
        const installerName = `${documentClass}.ins`;
        const bootstrap = buildDtxBootstrapPlan(documentClass, dtxName, dtx.buffer.toString("utf8"));
        await writeFile(join(directory, dtxName), dtx.buffer);
        await writeFile(join(directory, installerName), bootstrap.installerSource, "utf8");
        await runCompileCommand({ cwd: directory, command: { command: "tex", args: ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", installerName], phase: "engine" } });
        for (const outputFile of bootstrap.outputFiles) {
          await readFile(join(directory, outputFile)).then((buffer) => upstreamFiles.push({ path: outputFile, buffer })).catch(() => undefined);
        }
        await rm(join(directory, installerName), { force: true });
        await rm(join(directory, dtxName), { force: true });
      }
    }
    await writeFile(join(directory, "main.tex"), rendered.mainTex, "utf8");
    await writeFile(join(directory, "generated-content.tex"), rendered.generatedContentTex, "utf8");
    await writeFile(join(directory, "references.bib"), rendered.referencesBib, "utf8");
    const result = await runCompilePipeline({ cwd: directory, engine: compileEngine(compileManifest.engine), bibliography: compileManifest.bibliography });
    const pdf = await readFile(join(directory, "main.pdf"));
    if (pdf.byteLength === 0 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF 产物无效");
    const validation = row.validation && typeof row.validation === "object" && !Array.isArray(row.validation) ? row.validation as Record<string, unknown> : {};
    const cleanValidation = { ...validation };
    delete cleanValidation.sampleCompileError;
    delete cleanValidation.sampleCompileErrorCode;
    const samplePdfSha256 = createHash("sha256").update(pdf).digest("hex");
    const samplePdf = await uploadOrReuseSamplePdf(row.variantKey, pdf, samplePdfSha256);
    await prisma.templateVariant.update({
      where: { id: row.id },
      data: {
        validation: JSON.parse(JSON.stringify({ ...cleanValidation, status: "Verified", sampleCompileAt: new Date().toISOString(), samplePdfSha256, sourceFiles: upstreamFiles.length, resolvedDocumentClass: documentClass, compileEngine: compileEngine(manifest.engine), lastPhase: result.lastPhase })),
        sample: JSON.parse(JSON.stringify({ fixtureId: "sample-academic-v1", status: "verified", pdf: { provider: samplePdf.provider, key: samplePdf.key, sha256: samplePdfSha256, bytes: pdf.byteLength, mimeType: "application/pdf" } })),
      },
    });
    return { variantKey: row.variantKey, status: "Verified", files: upstreamFiles.length, pdfBytes: pdf.byteLength };
  } catch (error) {
    const validation = row.validation && typeof row.validation === "object" && !Array.isArray(row.validation) ? row.validation as Record<string, unknown> : {};
    const failure = normalizeValidationFailure(error);
    const previousSamplePdf = readTemplateSamplePdf(row.sample);
    await prisma.templateVariant.update({
      where: { id: row.id },
      data: {
        validation: JSON.parse(JSON.stringify({ ...validation, status: "Needs Review", sampleCompileAt: new Date().toISOString(), sampleCompileErrorCode: failure.code, sampleCompileError: failure.message })),
        sample: JSON.parse(JSON.stringify({ fixtureId: "sample-academic-v1", status: "needs_review", ...(previousSamplePdf ? { pdf: previousSamplePdf } : {}) })),
      },
    });
    return { variantKey: row.variantKey, status: "Needs Review", code: failure.code, error: failure.message };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const requested = requestedVariants();
  const rows = await prisma.templateVariant.findMany({ select: { id: true, variantKey: true, manifest: true, pinnedUpstreamSnapshot: true, validation: true, sample: true }, orderBy: { variantKey: "asc" } });
  const candidates = rows.filter((row) => requested ? requested.has(row.variantKey) : Boolean((row.pinnedUpstreamSnapshot as Record<string, unknown> | null)?.materialized)).slice(0, requested ? rows.length : validationLimit());
  const results = [];
  for (const [index, row] of candidates.entries()) {
    const result = await validateVariant(row);
    results.push(result);
    console.log(JSON.stringify({ completed: index + 1, total: candidates.length, ...result }));
  }
  console.log(JSON.stringify({ limits: compileResourceLimits(), selected: candidates.length, results }, null, 2));
  if (results.some((result) => result.status === "Needs Review")) process.exitCode = 1;
}

main().finally(async () => prisma.$disconnect());
