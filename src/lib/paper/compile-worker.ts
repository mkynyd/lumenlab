import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "node:child_process";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readStoredObject, uploadObjectBuffer, type StorageProvider } from "@/lib/storage/object-storage";
import { assertCompileArtifactSize, assertCompileBundleLimits, CompilePolicyError, compileResourceLimits, safeCompilePath } from "./compile-policy";
import { renderAcademicDocumentToLatex } from "./latex-renderer";
import { parseAcademicDocument } from "./document-schema";
import { buildGeneralAcademicTemplateManifest, normalizeTemplateManifest } from "./template-registry";
import { buildDtxBootstrapPlan, normalizeTemplateRuntimeBuffer, resolveTemplateBibliography, resolveTemplateDocumentClass } from "./template-snapshot";
import { mapCompileErrorToNode } from "./compile-errors";

const POLL_INTERVAL_MS = 1_000;
const GENERATED_TEMPLATE_PATHS = new Set(["main.tex", "generated-content.tex", "references.bib"]);

type CompilationError = {
  code: string;
  message: string;
  output?: string;
  nodeMap?: Record<string, { line: number; kind: string }>;
  nodeId?: string;
};

export type CompileCommand = {
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
  if (normalized.includes("biber") || normalized.includes("biblatex")) return "biber";
  if (normalized.includes("bibtex") || normalized === "bib") return "bibtex";
  throw new Error("模板 bibliography backend 只允许 bibtex、biber 或 none");
}

function engineFlag(engine: string): string {
  return engine === "pdflatex" ? "-pdf" : `-${engine}`;
}

const LATEX_ARGS = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "-synctex=1"];

export function buildCompileCommands(input: { engine?: string | null; bibliography?: string | null; preferLatexmk?: boolean; entryFile?: string } = {}): CompileCommand[] {
  const engine = compilerCommand(input.engine);
  const bibliography = bibliographyBackend(input.bibliography);
  const entryFile = safeCompilePath(input.entryFile ?? "main.tex");
  const commands: CompileCommand[] = [];
  if (input.preferLatexmk !== false) {
    commands.push({
      command: "latexmk",
      args: ["-norc", engineFlag(engine), ...LATEX_ARGS, entryFile],
      phase: "latexmk",
    });
  }
  commands.push({ command: engine, args: [...LATEX_ARGS, entryFile], phase: "engine" });
  if (bibliography) commands.push({ command: bibliography, args: ["main"], phase: bibliography });
  commands.push({ command: engine, args: [...LATEX_ARGS, entryFile], phase: "engine" });
  if (bibliography) commands.push({ command: engine, args: [...LATEX_ARGS, entryFile], phase: "engine" });
  return commands;
}

function timeoutMs(): number {
  return compileResourceLimits().wallTimeMs;
}

function normalizeOutput(output: string): string {
  return output
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/(?:https?|s?ftp):\/\/[^\s]+/gi, "[url]")
    .slice(-compileResourceLimits().maxLogBytes);
}

export function compileLinuxSandboxEnabled(environment: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return environment.PAPER_COMPILE_LINUX_SANDBOX === "true";
}

function compileEnvironment(cwd: string, sandboxed: boolean, environment: Partial<NodeJS.ProcessEnv>): Record<string, string> {
  const workspace = sandboxed ? "/compile-workspace" : cwd;
  return {
    NODE_ENV: "production",
    PATH: environment.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    HOME: `${workspace}/.home`,
    TMPDIR: `${workspace}/.tmp`,
    TEXMFOUTPUT: `${workspace}/.texmf-output`,
    TEXINPUTS: `${workspace}//:`,
    BIBINPUTS: `${workspace}//:`,
    BSTINPUTS: `${workspace}//:`,
    SOURCE_DATE_EPOCH: "0",
  };
}

export function buildCompileInvocation(input: {
  cwd: string;
  command: CompileCommand;
  environment?: Partial<NodeJS.ProcessEnv>;
}): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const environment = input.environment ?? process.env;
  const sandboxed = compileLinuxSandboxEnabled(environment);
  const childEnvironment = compileEnvironment(input.cwd, sandboxed, environment);
  if (!sandboxed) {
    return {
      command: input.command.command,
      args: input.command.args,
      env: childEnvironment as NodeJS.ProcessEnv,
    };
  }

  // The service still needs its control-plane network for PostgreSQL and
  // object storage. Only the TeX toolchain enters this namespace, where the
  // host filesystem is read-only and the compile workspace is the writable
  // bind mount.
  return {
    command: environment.PAPER_COMPILE_SANDBOX_COMMAND ?? "bwrap",
    args: [
      "--die-with-parent",
      "--new-session",
      "--unshare-user-try",
      "--unshare-net",
      "--ro-bind",
      "/",
      "/",
      "--bind",
      input.cwd,
      "/compile-workspace",
      "--tmpfs",
      "/tmp",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--chdir",
      "/compile-workspace",
      "--clearenv",
      ...Object.entries(childEnvironment).flatMap(([key, value]) => ["--setenv", key, value]),
      "--",
      input.command.command,
      ...input.command.args,
    ],
    env: {
      NODE_ENV: "production",
      PATH: environment.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    },
  };
}

export async function runCompileCommand(input: { cwd: string; command: CompileCommand }): Promise<string> {
  const output: string[] = [];
  const invocation = buildCompileInvocation(input);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: input.cwd,
      shell: false,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
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

export async function runCompilePipeline(input: { cwd: string; engine?: string | null; bibliography?: string | null; entryFile?: string }): Promise<{ output: string; lastPhase: CompileCommand["phase"] }> {
  const commands = buildCompileCommands({ engine: input.engine, bibliography: input.bibliography, entryFile: input.entryFile });
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

async function materializeTemplateFiles(input: { cwd: string; manifest: ReturnType<typeof normalizeTemplateManifest> }): Promise<Array<{ path: string; buffer: Buffer }>> {
  const snapshot = input.manifest.upstreamSnapshot;
  if (!snapshot?.materialized || !snapshot.sourceArchive?.key) return [];
  const archiveBuffer = await readStoredObject({ provider: snapshot.sourceArchive.provider, key: snapshot.sourceArchive.key });
  const archive = await JSZip.loadAsync(archiveBuffer);
  const files: Array<{ path: string; buffer: Buffer }> = [];
  for (const [rawPath, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const path = safeCompilePath(rawPath);
    const buffer = normalizeTemplateRuntimeBuffer(path, await entry.async("nodebuffer"));
    // Keep upstream entry files in memory for class/package discovery, but do
    // not let them replace the adapter-owned generated compilation inputs.
    if (!GENERATED_TEMPLATE_PATHS.has(path)) {
      await mkdir(join(input.cwd, dirname(path)), { recursive: true });
      await writeFile(join(input.cwd, path), buffer);
    }
    files.push({ path, buffer });
  }
  const documentClass = resolveTemplateDocumentClass(input.manifest, files);
  if (documentClass && !files.some((file) => file.path === `${documentClass}.cls` || file.path.endsWith(`/${documentClass}.cls`))) {
    const installer = files.find((file) => file.path === `${documentClass}.ins` || file.path.endsWith(`/${documentClass}.ins`));
    if (installer) {
      const installerDirectory = dirname(installer.path) === "." ? "" : dirname(installer.path);
      const installerStem = basename(installer.path, ".ins");
      const bootstrapEntry = `${installerStem}.tex`;
      const installerPrefix = installerDirectory ? `${installerDirectory}/` : "";
      const installerDtx = files.filter((file) => file.path.startsWith(installerPrefix) && file.path.endsWith(".dtx"));
      const copiedDtx = installerDirectory ? installerDtx.map((file) => basename(file.path)) : [];
      for (const file of installerDtx) await writeFile(join(input.cwd, basename(file.path)), file.buffer);
      await writeFile(join(input.cwd, bootstrapEntry), `\\input{${installer.path}}\n`, "utf8");
      try {
        await runCompileCommand({ cwd: input.cwd, command: { command: "xelatex", args: [...LATEX_ARGS, bootstrapEntry], phase: "engine" } });
      } finally {
        await rm(join(input.cwd, bootstrapEntry), { force: true });
        for (const file of copiedDtx) await rm(join(input.cwd, file), { force: true });
        for (const output of ["aux", "log", "pdf", "synctex.gz", "fdb_latexmk", "fls"].map((suffix) => `${installerStem}.${suffix}`)) {
          await rm(join(input.cwd, output), { force: true });
        }
      }
      const generatedClassPath = `${documentClass}.cls`;
      const generatedClass = join(input.cwd, generatedClassPath);
      await access(generatedClass).catch(() => { throw new Error(`TEMPLATE_BOOTSTRAP_FAILED：未生成 ${generatedClassPath}`); });
      const rootClass = join(input.cwd, generatedClassPath);
      if (generatedClass !== rootClass) await writeFile(rootClass, await readFile(generatedClass));
      files.push({ path: generatedClassPath, buffer: await readFile(rootClass) });
    } else {
      const dtx = files.find((file) => file.path.endsWith(`/${documentClass}.dtx`) || file.path === `${documentClass}.dtx` || file.buffer?.toString("utf8").match(new RegExp(`\\\\Provides(?:Expl)?Class\\s*\\{${documentClass}\\}`, "i")));
      if (dtx) {
        const dtxName = basename(dtx.path);
        const installerName = `${documentClass}.ins`;
        const bootstrap = buildDtxBootstrapPlan(documentClass, dtxName, dtx.buffer?.toString("utf8") ?? "");
        await writeFile(join(input.cwd, dtxName), dtx.buffer ?? Buffer.alloc(0));
        await writeFile(join(input.cwd, installerName), bootstrap.installerSource, "utf8");
        try {
          await runCompileCommand({ cwd: input.cwd, command: { command: "tex", args: ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", installerName], phase: "engine" } });
        } finally {
          await rm(join(input.cwd, installerName), { force: true });
          await rm(join(input.cwd, dtxName), { force: true });
          for (const output of ["aux", "log", "pdf", "synctex.gz", "fdb_latexmk", "fls"].map((suffix) => `${documentClass}.${suffix}`)) {
            await rm(join(input.cwd, output), { force: true });
          }
        }
        const generatedClassPath = `${documentClass}.cls`;
        const generatedClass = join(input.cwd, generatedClassPath);
        await access(generatedClass).catch(() => { throw new Error(`TEMPLATE_BOOTSTRAP_FAILED：未生成 ${generatedClassPath}`); });
        for (const outputFile of bootstrap.outputFiles) {
          const generatedPath = join(input.cwd, outputFile);
          await access(generatedPath).then(async () => files.push({ path: outputFile, buffer: await readFile(generatedPath) })).catch(() => undefined);
        }
      }
    }
  }
  return files;
}

export async function sourceBundle(input: {
  mainTex: string;
  generatedContentTex: string;
  referencesBib: string;
  manifest: unknown;
  assets?: Array<{ path: string; buffer: Buffer }>;
  files?: Array<{ path: string; buffer: Buffer }>;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("main.tex", input.mainTex);
  zip.file("generated-content.tex", input.generatedContentTex);
  zip.file("references.bib", input.referencesBib);
  zip.file("template-manifest.json", JSON.stringify(input.manifest, null, 2));
  for (const file of input.files ?? []) {
    const path = safeCompilePath(file.path);
    if (GENERATED_TEMPLATE_PATHS.has(path)) continue;
    zip.file(path, file.buffer);
  }
  for (const asset of input.assets ?? []) zip.file(safeCompilePath(asset.path), asset.buffer);
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
    engine = compilerCommand(compilation.engine);
    const upstreamFiles = await materializeTemplateFiles({ cwd: tempDirectory, manifest });
    const resolvedClass = resolveTemplateDocumentClass(manifest, upstreamFiles);
    if (manifest.upstreamSnapshot?.materialized && !resolvedClass) {
      throw new Error("TEMPLATE_MANIFEST_INCOMPLETE：pinned Template Pack 没有可用 documentClass");
    }
    const effectiveManifest = resolvedClass && resolvedClass !== manifest.documentClass ? { ...manifest, documentClass: resolvedClass } : manifest;
    const compileManifest = resolveTemplateBibliography(effectiveManifest, upstreamFiles);
    const rendered = renderAcademicDocumentToLatex(document, {
      manifest: compileManifest,
      references: compilation.documentVersion.document.workspace.references,
      assetPaths,
      templateFiles: upstreamFiles,
    });
    nodeMap = rendered.nodeMap;
    await writeFile(join(tempDirectory, "main.tex"), rendered.mainTex, "utf8");
    await writeFile(join(tempDirectory, "generated-content.tex"), rendered.generatedContentTex, "utf8");
    await writeFile(join(tempDirectory, "references.bib"), rendered.referencesBib, "utf8");
    await mkdir(join(tempDirectory, "assets"), { recursive: true });
    await mkdir(join(tempDirectory, ".home"), { recursive: true });
    await mkdir(join(tempDirectory, ".tmp"), { recursive: true });
    await mkdir(join(tempDirectory, ".texmf-output"), { recursive: true });
    const assetFiles = await Promise.all(assets.map(async (asset) => {
      const buffer = await readStoredObject({ provider: asset.storageProvider as StorageProvider, key: asset.storagePath });
      const path = assetPaths[asset.id];
      await writeFile(join(tempDirectory, path), buffer);
      return { path, buffer };
    }));
    assertCompileBundleLimits({
      files: [
        { path: "main.tex", bytes: Buffer.byteLength(rendered.mainTex) },
        { path: "generated-content.tex", bytes: Buffer.byteLength(rendered.generatedContentTex) },
        { path: "references.bib", bytes: Buffer.byteLength(rendered.referencesBib) },
        ...assetFiles.map((asset) => ({ path: asset.path, bytes: asset.buffer.byteLength })),
        ...upstreamFiles.map((file) => ({ path: file.path, bytes: file.buffer.byteLength })),
      ],
    });
    const source = await sourceBundle({ ...rendered, manifest: compileManifest, assets: assetFiles, files: upstreamFiles });
    assertCompileArtifactSize(source.byteLength);

    await runCompilePipeline({ cwd: tempDirectory, engine, bibliography: compileManifest.bibliography });
    const pdf = await readFile(join(tempDirectory, "main.pdf"));
    const syncTexBuffer = await readFile(join(tempDirectory, "main.synctex.gz")).catch(() => null);
    assertCompileArtifactSize(pdf.byteLength);
    if (syncTexBuffer) assertCompileArtifactSize(syncTexBuffer.byteLength);
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
      code: error instanceof CompilePolicyError ? error.code : error instanceof Error && /(?:usage:\s*lipo|Could not open biber log file)/i.test(error.message) ? "BIBLIOGRAPHY_BACKEND_UNAVAILABLE" : error instanceof Error && (error as CompileProcessError).code === "COMPILE_TIMEOUT" ? "COMPILE_TIMEOUT" : error instanceof Error && (error as CompileProcessError).code === "MISSING_EXECUTABLE" ? "COMPILER_MISSING" : "COMPILE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? (error as CompileProcessError).output : undefined,
      nodeMap,
    };
    const mappedNode = mapCompileErrorToNode({ output: detail.output, nodeMap });
    if (mappedNode) detail.nodeId = mappedNode.nodeId;
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
