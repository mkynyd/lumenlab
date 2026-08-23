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

type CompileCommand = {
  command: string;
  args: string[];
  phase: "latexmk" | "engine" | "bibtex" | "biber";
};

type CompileProcessError = Error & {
  code?: "MISSING_EXECUTABLE" | "COMMAND_FAILED" | "COMPILE_TIMEOUT";
  output?: string;
};

export function compilerCommand(requested?: string | null): string {
  const engine = requested ?? process.env.PAPER_TEX_ENGINE ?? "xelatex";
  if (!/^(xelatex|pdflatex|lualatex)$/.test(engine)) {
    throw new Error("PAPER_TEX_ENGINE 只允许 xelatex、pdflatex 或 lualatex");
  }
  return engine;
}

function bibliographyBackend(value?: string | null): "bibtex" | "biber" | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized === "none") return null;
  if (normalized.includes("biber")) return "biber";
  if (normalized.includes("bibtex") || normalized === "bib") return "bibtex";
  throw new Error("模板 bibliography backend 只允许 bibtex、biber 或 none");
}

function engineFlag(engine: string): string {
  return engine === "pdflatex" ? "-pdf" : `-${engine}`;
}

const LATEX_ARGS = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "-synctex=1"];

export function buildCompileCommands(input: { engine?: string | null; bibliography?: string | null; preferLatexmk?: boolean } = {}): CompileCommand[] {
  const engine = compilerCommand(input.engine);
  const bibliography = bibliographyBackend(input.bibliography);
  const commands: CompileCommand[] = [];
  if (input.preferLatexmk !== false) {
    commands.push({
      command: "latexmk",
      args: [engineFlag(engine), ...(bibliography === "biber" ? ["-usebiber"] : bibliography === "bibtex" ? ["-bibtex"] : []), ...LATEX_ARGS, "main.tex"],
      phase: "latexmk",
    });
  }
  commands.push({ command: engine, args: [...LATEX_ARGS, "main.tex"], phase: "engine" });
  if (bibliography) commands.push({ command: bibliography, args: ["main"], phase: bibliography });
  commands.push({ command: engine, args: [...LATEX_ARGS, "main.tex"], phase: "engine" });
  if (bibliography) commands.push({ command: engine, args: [...LATEX_ARGS, "main.tex"], phase: "engine" });
  return commands;
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

async function runCompileCommand(input: { cwd: string; command: CompileCommand }): Promise<string> {
  const output: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command.command, input.command.args, {
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
      const error = new Error("LaTeX 编译超时") as CompileProcessError;
      error.code = "COMPILE_TIMEOUT";
      reject(error);
    }, timeoutMs());
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.once("error", (error) => {
      clearTimeout(timer);
      const processError = error as CompileProcessError;
      const systemCode = (error as NodeJS.ErrnoException).code;
      processError.code = systemCode === "ENOENT" ? "MISSING_EXECUTABLE" : "COMMAND_FAILED";
      reject(processError);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const result = normalizeOutput(output.join(""));
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(result || `LaTeX 编译退出码 ${code ?? "unknown"}`) as CompileProcessError;
        error.code = "COMMAND_FAILED";
        error.output = result;
        reject(error);
      }
    });
  });
  return normalizeOutput(output.join(""));
}

async function runCompilePipeline(input: { cwd: string; engine?: string | null; bibliography?: string | null }): Promise<{ output: string; lastPhase: CompileCommand["phase"] }> {
  const commands = buildCompileCommands({ engine: input.engine, bibliography: input.bibliography });
  const output: string[] = [];
  for (const command of commands) {
    try {
      output.push(await runCompileCommand({ cwd: input.cwd, command }));
      if (command.phase === "latexmk") return { output: normalizeOutput(output.join("\n")), lastPhase: command.phase };
    } catch (error) {
      const processError = error as CompileProcessError;
      // latexmk is an optional convenience wrapper. A missing executable falls
      // back to the explicit engine/bibliography sequence; a real TeX failure
      // must be surfaced and must not be hidden by a second attempt.
      if (command.phase === "latexmk" && processError.code === "MISSING_EXECUTABLE") continue;
      throw error;
    }
  }
  return { output: normalizeOutput(output.join("\n")), lastPhase: "engine" };
}

export async function sourceBundle(input: {
  mainTex: string;
  generatedContentTex: string;
  referencesBib: string;
  manifest: unknown;
  assets?: Array<{ path: string; buffer: Buffer }>;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("main.tex", input.mainTex);
  zip.file("generated-content.tex", input.generatedContentTex);
  zip.file("references.bib", input.referencesBib);
  zip.file("template-manifest.json", JSON.stringify(input.manifest, null, 2));
  for (const asset of input.assets ?? []) zip.file(asset.path, asset.buffer);
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
  let engine = "xelatex";
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
    engine = compilerCommand(compilation.engine);
    nodeMap = rendered.nodeMap;
    await writeFile(join(tempDirectory, "main.tex"), rendered.mainTex, "utf8");
    await writeFile(join(tempDirectory, "generated-content.tex"), rendered.generatedContentTex, "utf8");
    await writeFile(join(tempDirectory, "references.bib"), rendered.referencesBib, "utf8");
    await mkdir(join(tempDirectory, "assets"), { recursive: true });
    const assetFiles = await Promise.all(assets.map(async (asset) => {
      const buffer = await readStoredObject({ provider: asset.storageProvider as StorageProvider, key: asset.storagePath });
      const path = assetPaths[asset.id];
      await writeFile(join(tempDirectory, path), buffer);
      return { path, buffer };
    }));
    const source = await sourceBundle({ ...rendered, manifest, assets: assetFiles });

    await runCompilePipeline({ cwd: tempDirectory, engine, bibliography: manifest.bibliography });
    const pdf = await readFile(join(tempDirectory, "main.pdf"));
    const syncTexBuffer = await readFile(join(tempDirectory, "main.synctex.gz")).catch(() => null);
    const baseKey = `papers/${compilation.documentVersion.document.userId}/${compilation.documentVersionId}/${compilation.id}`;
    const [pdfObject, sourceObject, syncTexObject] = await Promise.all([
      uploadObjectBuffer({ key: `${baseKey}/main.pdf`, mimeType: "application/pdf", buffer: pdf }),
      uploadObjectBuffer({ key: `${baseKey}/source.zip`, mimeType: "application/zip", buffer: source }),
      syncTexBuffer ? uploadObjectBuffer({ key: `${baseKey}/main.synctex.gz`, mimeType: "application/gzip", buffer: syncTexBuffer }) : Promise.resolve(null),
    ]);
    await prisma.paperCompilation.update({
      where: { id: compilation.id },
      data: {
        status: "succeeded",
        engine,
        pdfStorageProvider: pdfObject.provider,
        pdfObjectKey: pdfObject.key,
        sourceStorageProvider: sourceObject.provider,
        sourceObjectKey: sourceObject.key,
        syncTex: syncTexObject ? { provider: syncTexObject.provider, key: syncTexObject.key, format: "synctex.gz" } : undefined,
        errorLog: { nodeMap },
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const detail: CompilationError = {
      code: error instanceof Error && (error as CompileProcessError).code === "COMPILE_TIMEOUT" ? "COMPILE_TIMEOUT" : error instanceof Error && (error as CompileProcessError).code === "MISSING_EXECUTABLE" ? "COMPILER_MISSING" : "COMPILE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? (error as CompileProcessError).output : undefined,
      nodeMap,
    };
    await prisma.paperCompilation.update({
      where: { id: compilation.id },
      data: { status: "failed", engine, errorLog: detail, completedAt: new Date() },
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
