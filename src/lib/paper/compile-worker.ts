import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readStoredObject, uploadObjectBuffer, type StorageProvider } from "@/lib/storage/object-storage";
import { renderAcademicDocumentToLatex } from "./latex-renderer";
import { parseAcademicDocument } from "./document-schema";
import { buildGeneralAcademicTemplateManifest, normalizeTemplateManifest } from "./template-registry";

const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

type CompilationError = {
  code: string;
  message: string;
  output?: string;
  nodeMap?: Record<string, { line: number; kind: string }>;
};

function compilerCommand(requested?: string | null): string {
  const engine = requested ?? process.env.PAPER_TEX_ENGINE ?? "xelatex";
  if (!/^(xelatex|pdflatex|lualatex)$/.test(engine)) {
    throw new Error("PAPER_TEX_ENGINE 只允许 xelatex、pdflatex 或 lualatex");
  }
  return engine;
}

function timeoutMs(): number {
  const configured = Number(process.env.PAPER_COMPILE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 10_000
    ? Math.min(configured, 300_000)
    : DEFAULT_TIMEOUT_MS;
}

function normalizeOutput(output: string): string {
  return output
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/(?:https?|s?ftp):\/\/[^\s]+/gi, "[url]")
    .slice(-12_000);
}

async function runCompiler(input: { cwd: string; command: string }): Promise<string> {
  const args = [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    "-no-shell-escape",
    "main.tex",
  ];
  const output: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, args, {
      cwd: input.cwd,
      shell: false,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "/Library/TeX/texbin:/usr/bin:/bin:/opt/homebrew/bin",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
      },
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("LaTeX 编译超时"));
    }, timeoutMs());
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const result = normalizeOutput(output.join(""));
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(result || `LaTeX 编译退出码 ${code ?? "unknown"}`));
      }
    });
  });
  return normalizeOutput(output.join(""));
}

async function sourceBundle(input: {
  mainTex: string;
  generatedContentTex: string;
  referencesBib: string;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("main.tex", input.mainTex);
  zip.file("generated-content.tex", input.generatedContentTex);
  zip.file("references.bib", input.referencesBib);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function claimCompilation() {
  const candidate = await prisma.paperCompilation.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;
  const claimed = await prisma.paperCompilation.updateMany({
    where: { id: candidate.id, status: "queued" },
    data: { status: "running", startedAt: new Date(), completedAt: null },
  });
  if (claimed.count !== 1) return null;
  return prisma.paperCompilation.findUnique({
    where: { id: candidate.id },
    include: {
      documentVersion: {
        include: {
          document: {
            select: {
              userId: true,
              workspace: { include: { references: true } },
              bindings: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
            },
          },
        },
      },
    },
  });
}

async function processCompilation(compilation: NonNullable<Awaited<ReturnType<typeof claimCompilation>>>) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "lumenlab-paper-"));
  let command = "xelatex";
  let nodeMap: Record<string, { line: number; kind: string }> = {};
  try {
    const document = parseAcademicDocument(compilation.documentVersion.content);
    const bindingVersion = compilation.documentVersion.document.bindings[0]?.versions[0];
    const manifest = bindingVersion ? normalizeTemplateManifest(bindingVersion.manifestSnapshot) : buildGeneralAcademicTemplateManifest();
    const figureIds = document.blocks.filter((block): block is Extract<typeof block, { kind: "figure" }> => block.kind === "figure").map((block) => block.assetId);
    const assets = await prisma.fileAsset.findMany({ where: { id: { in: figureIds }, userId: compilation.documentVersion.document.userId }, select: { id: true, originalName: true, storageProvider: true, storagePath: true } });
    if (assets.length !== new Set(figureIds).size) throw new Error("FIGURE_ASSET_MISSING：论文图片资源不存在或无权访问");
    const assetPaths = Object.fromEntries(assets.map((asset) => [asset.id, `assets/${asset.id}${extname(asset.originalName).toLowerCase() || ".bin"}`]));
    const rendered = renderAcademicDocumentToLatex(document, {
      manifest,
      references: compilation.documentVersion.document.workspace.references,
      assetPaths,
    });
    command = compilerCommand(compilation.engine);
    const source = await sourceBundle(rendered);
    nodeMap = rendered.nodeMap;
    await writeFile(join(tempDirectory, "main.tex"), rendered.mainTex, "utf8");
    await writeFile(join(tempDirectory, "generated-content.tex"), rendered.generatedContentTex, "utf8");
    await writeFile(join(tempDirectory, "references.bib"), rendered.referencesBib, "utf8");
    await mkdir(join(tempDirectory, "assets"), { recursive: true });
    await Promise.all(assets.map(async (asset) => {
      const buffer = await readStoredObject({ provider: asset.storageProvider as StorageProvider, key: asset.storagePath });
      await writeFile(join(tempDirectory, assetPaths[asset.id]), buffer);
    }));

    // Run twice so labels and cross references settle without relying on a
    // user-provided shell command or an unrestricted latexmk invocation.
    await runCompiler({ cwd: tempDirectory, command });
    await runCompiler({ cwd: tempDirectory, command });
    const pdf = await readFile(join(tempDirectory, "main.pdf"));
    const baseKey = `papers/${compilation.documentVersion.document.userId}/${compilation.documentVersionId}/${compilation.id}`;
    const [pdfObject, sourceObject] = await Promise.all([
      uploadObjectBuffer({ key: `${baseKey}/main.pdf`, mimeType: "application/pdf", buffer: pdf }),
      uploadObjectBuffer({ key: `${baseKey}/source.zip`, mimeType: "application/zip", buffer: source }),
    ]);
    await prisma.paperCompilation.update({
      where: { id: compilation.id },
      data: {
        status: "succeeded",
        engine: command,
        pdfStorageProvider: pdfObject.provider,
        pdfObjectKey: pdfObject.key,
        sourceStorageProvider: sourceObject.provider,
        sourceObjectKey: sourceObject.key,
        errorLog: { nodeMap },
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const detail: CompilationError = {
      code: error instanceof Error && /超时/.test(error.message) ? "COMPILE_TIMEOUT" : "COMPILE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      nodeMap,
    };
    await prisma.paperCompilation.update({
      where: { id: compilation.id },
      data: { status: "failed", engine: command, errorLog: detail, completedAt: new Date() },
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

type WorkerGlobal = typeof globalThis & { __lumenPaperCompilationWorker?: boolean };

export function startPaperCompilationWorker() {
  const globalWorker = globalThis as WorkerGlobal;
  if (globalWorker.__lumenPaperCompilationWorker) {
    return { started: false, workerId: "existing-process-worker" };
  }
  globalWorker.__lumenPaperCompilationWorker = true;
  const workerId = `paper:${process.pid}:${randomUUID()}`;
  const drain = async () => {
    try {
      const compilation = await claimCompilation();
      if (compilation) await processCompilation(compilation);
    } catch (error) {
      logger.error("Paper compilation worker iteration failed", {
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  void drain();
  setInterval(() => void drain(), POLL_INTERVAL_MS);
  return { started: true, workerId };
}
