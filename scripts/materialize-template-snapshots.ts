import "dotenv/config";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "@/lib/db";
import { activeStorageProvider, readStoredObject, uploadObjectBuffer, type StoredObjectRef } from "@/lib/storage/object-storage";
import { normalizeTemplateManifest, parseTemplateRegistry, type TemplateRegistryRecord } from "@/lib/paper/template-registry";
import { githubRepositorySlug, normalizeTemplateEntries, normalizeTemplateTarGz, normalizeTemplateZip } from "@/lib/paper/template-snapshot";
import JSZip from "jszip";

const root = process.env.TEMPLATE_REGISTRY_ROOT
  ? path.resolve(process.env.TEMPLATE_REGISTRY_ROOT)
  : path.resolve(process.cwd(), "resources/cn-thesis-templates");
const NORMALIZATION_VERSION = "normalized-v2";
const SUBMODULE_NORMALIZATION_VERSION = "normalized-v3-submodules";
const execFileAsync = promisify(execFile);

function requestedRepositories(): Set<string> | null {
  const value = process.env.TEMPLATE_MATERIALIZE_REPOSITORIES?.trim();
  if (!value) return null;
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

function discoverableSourceUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return /(?:^|\.)overleaf\.com$/i.test(url.hostname) || url.hostname === "ctan.org" || url.hostname === "www.ctan.org" || url.hostname === "typst.app";
  } catch {
    return false;
  }
}

function materializationLimit(): number {
  const value = Number(process.env.TEMPLATE_MATERIALIZE_LIMIT ?? 12);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 200) : 12;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers: { Accept: "application/vnd.github+json", "User-Agent": "lumenlab-template-snapshot/1.0", ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

function versionRefs(value: string | null): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) return [];
  const refs = [trimmed];
  if (/^\d+\.\d+(?:\.\d+)?$/.test(trimmed)) refs.push(`v${trimmed}`);
  return [...new Set(refs)];
}

async function resolveGitRemote(slug: string, refs: string[]): Promise<string | null> {
  const remote = `https://github.com/${slug}.git`;
  const args = refs.length > 0
    ? ["ls-remote", "--refs", remote, ...refs.flatMap((ref) => [`refs/tags/${ref}`, `refs/heads/${ref}`])]
    : ["ls-remote", remote, "HEAD"];
  try {
    const result = await execFileAsync("git", args, { timeout: 90_000, maxBuffer: 1024 * 1024 });
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const sha = line.split(/\s+/)[0];
      if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
    }
  } catch {
    return null;
  }
  return null;
}

async function resolveCommit(slug: string, requestedVersion: string | null): Promise<string> {
  if (requestedVersion && /^[0-9a-f]{7,40}$/i.test(requestedVersion)) return requestedVersion;
  const tagged = await resolveGitRemote(slug, versionRefs(requestedVersion));
  const head = tagged ?? await resolveGitRemote(slug, []);
  if (!head) throw new Error(`GitHub commit 查询失败：${slug}`);
  return head;
}

async function downloadSnapshot(slug: string, commit: string) {
  const response = await fetchWithTimeout(`https://github.com/${slug}/archive/${commit}.zip`, { headers: { Accept: "application/zip" } });
  if (!response.ok) throw new Error(`GitHub snapshot 下载失败：${slug}@${commit} (${response.status})`);
  const archive = Buffer.from(await response.arrayBuffer());
  return normalizeTemplateZip(archive);
}

async function gitCommand(args: string[], cwd?: string) {
  return execFileAsync("git", args, { cwd, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
}

async function collectGitFiles(rootDirectory: string, currentDirectory = ""): Promise<Array<{ path: string; bytes: Buffer }>> {
  const absoluteDirectory = path.join(rootDirectory, currentDirectory);
  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  const files: Array<{ path: string; bytes: Buffer }> = [];
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const relativePath = currentDirectory ? path.join(currentDirectory, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectGitFiles(rootDirectory, relativePath));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({ path: relativePath.split(path.sep).join("/"), bytes: await fs.readFile(path.join(rootDirectory, relativePath)) });
  }
  return files;
}

/**
 * GitHub archive downloads omit submodule contents. For a pinned repository
 * that declares submodules, use a temporary shallow checkout so the exact
 * gitlink commit is resolved by Git itself, then discard the checkout and
 * persist only the normalized object-storage snapshot.
 */
async function downloadSnapshotWithSubmodules(slug: string, commit: string) {
  const archiveSnapshot = await downloadSnapshot(slug, commit);
  const archive = await JSZip.loadAsync(archiveSnapshot.buffer);
  const hasGitmodules = Object.keys(archive.files).some((filePath) => filePath === ".gitmodules");
  if (!hasGitmodules) return { ...archiveSnapshot, normalizationVersion: NORMALIZATION_VERSION };

  const temporaryRoot = await fs.mkdtemp(path.join(tmpdir(), "lumenlab-template-git-"));
  const checkout = path.join(temporaryRoot, "repo");
  try {
    await gitCommand(["clone", "--no-checkout", "--filter=blob:none", "--no-tags", `https://github.com/${slug}.git`, checkout]);
    try {
      await gitCommand(["checkout", "--detach", commit], checkout);
    } catch {
      await gitCommand(["fetch", "--depth=1", "origin", commit], checkout);
      await gitCommand(["checkout", "--detach", commit], checkout);
    }
    await gitCommand(["submodule", "update", "--init", "--recursive"], checkout);
    return { ...(await normalizeTemplateEntries(await collectGitFiles(checkout))), normalizationVersion: SUBMODULE_NORMALIZATION_VERSION };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function downloadTypstSnapshot(url: string) {
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/gzip" } });
  if (!response.ok) throw new Error(`Typst 包下载失败：${url} (${response.status})`);
  return { ...(await normalizeTemplateTarGz(Buffer.from(await response.arrayBuffer()))), normalizationVersion: NORMALIZATION_VERSION };
}

async function uploadOrReuseSnapshot(key: string, buffer: Buffer): Promise<StoredObjectRef> {
  try {
    return await uploadObjectBuffer({ key, mimeType: "application/zip", buffer });
  } catch (error) {
    // Qiniu insertOnly uploads return 614 when a deterministic commit key is
    // already present. Reuse it only after reading and hashing the object;
    // silently accepting a different payload would corrupt a pinned snapshot.
    if (!/614/.test(error instanceof Error ? error.message : String(error))) throw error;
    const existing = { provider: activeStorageProvider(), key } satisfies StoredObjectRef;
    const stored = await readStoredObject(existing);
    const expectedHash = createHash("sha256").update(buffer).digest("hex");
    const actualHash = createHash("sha256").update(stored).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`模板快照已存在但校验和不匹配：${key}`);
    return existing;
  }
}

async function discoverGithubRepository(sourceUrl: string): Promise<string | null> {
  const response = await fetchWithTimeout(sourceUrl, { headers: { Accept: "text/html" } });
  if (!response.ok) throw new Error(`模板来源页面读取失败：${sourceUrl} (${response.status})`);
  const html = await response.text();
  const slugs = [...new Set([...html.matchAll(/https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/gi)]
    .map((match) => githubRepositorySlug(`https://github.com/${match[1]}`))
    .filter((slug): slug is string => Boolean(slug))
    .filter((slug) => !/^typst\/(?:packages|typst)$/i.test(slug)))];
  const sourceName = sourceUrl.split("/").filter(Boolean).at(-1)?.replace(/[^a-z0-9]+/gi, "").toLowerCase() ?? "";
  return slugs.sort((left, right) => {
    const score = (slug: string) => {
      const normalized = slug.replace(/[^a-z0-9]+/gi, "").toLowerCase();
      return sourceName && normalized.includes(sourceName) ? 2 : normalized.includes("thesis") ? 1 : 0;
    };
    return score(right) - score(left) || left.localeCompare(right);
  })[0] ?? null;
}

async function discoverTypstPackage(sourceUrl: string): Promise<{ archiveUrl: string; packageName: string; version: string } | null> {
  let url: URL;
  try { url = new URL(sourceUrl); } catch { return null; }
  if (url.hostname !== "typst.app") return null;
  const response = await fetchWithTimeout(sourceUrl, { headers: { Accept: "text/html" } });
  if (!response.ok) throw new Error(`Typst 来源页面读取失败：${sourceUrl} (${response.status})`);
  const html = await response.text();
  const match = html.match(/https:\/\/packages\.typst\.org\/[^"'\s]+\/([^/?#]+?)-(\d+\.\d+(?:\.\d+)?)\.tar\.gz/i);
  if (!match) return null;
  return { archiveUrl: match[0], packageName: match[1], version: match[2] };
}

function sourceKey(record: TemplateRegistryRecord): string | null {
  const slug = githubRepositorySlug(record.repositoryUrl ?? "");
  if (slug) return `github:${slug}`;
  return discoverableSourceUrl(record.repositoryUrl) ? `page:${record.repositoryUrl}` : null;
}

function matchingRecords(records: TemplateRegistryRecord[], source: TemplateRegistryRecord, slug: string): TemplateRegistryRecord[] {
  return records.filter((record) => githubRepositorySlug(record.repositoryUrl ?? "") === slug || record.repositoryUrl === source.repositoryUrl);
}

async function updateVariants(records: TemplateRegistryRecord[], source: TemplateRegistryRecord, slug: string, commit: string, snapshot: Awaited<ReturnType<typeof downloadSnapshotWithSubmodules>> | Awaited<ReturnType<typeof downloadTypstSnapshot>>) {
  const matching = matchingRecords(records, source, slug);
  const sourceArchive = await uploadOrReuseSnapshot(`template-snapshots/${slug.replace(/[^A-Za-z0-9_.-]+/g, "__")}/${commit}.${snapshot.normalizationVersion ?? NORMALIZATION_VERSION}.zip`, snapshot.buffer);
  let updated = 0;
  for (const record of matching) {
    const variantKey = `${record.id}:default`;
    const variant = await prisma.templateVariant.findUnique({ where: { variantKey } });
    if (!variant) continue;
    const manifest = normalizeTemplateManifest(variant.manifest);
    const upstreamSnapshot = {
      ...(manifest.upstreamSnapshot ?? {}),
      snapshotId: `${variantKey}:${commit}`,
      repositoryUrl: record.repositoryUrl,
      commitOrVersion: commit,
      materialized: true,
      sourceFiles: snapshot.files,
      sourceArchive: { provider: sourceArchive.provider, key: sourceArchive.key, sha256: snapshot.sha256, bytes: snapshot.bytes, format: "zip" as const },
    };
    const nextManifest = { ...manifest, upstreamSnapshot };
    await prisma.templateVariant.update({
      where: { id: variant.id },
      data: {
        manifest: JSON.parse(JSON.stringify(nextManifest)),
        pinnedUpstreamSnapshot: JSON.parse(JSON.stringify(upstreamSnapshot)),
        validation: JSON.parse(JSON.stringify({ ...(variant.validation && typeof variant.validation === "object" ? variant.validation : {}), sourceMaterializationStatus: "materialized", sourceMaterializedAt: new Date().toISOString(), sourceCommit: commit })),
      },
    });
    updated += 1;
  }
  return updated;
}

async function markMaterializationFailure(records: TemplateRegistryRecord[], source: TemplateRegistryRecord, slug: string | null, error: string) {
  const matching = slug ? matchingRecords(records, source, slug) : [source];
  for (const record of matching) {
    const variant = await prisma.templateVariant.findUnique({ where: { variantKey: `${record.id}:default` }, select: { id: true, validation: true } });
    if (!variant) continue;
    const validation = variant.validation && typeof variant.validation === "object" && !Array.isArray(variant.validation) ? variant.validation as Record<string, unknown> : {};
    await prisma.templateVariant.update({
      where: { id: variant.id },
      data: {
        validation: JSON.parse(JSON.stringify({ ...validation, sourceMaterializationStatus: "failed", sourceMaterializationAttemptedAt: new Date().toISOString(), sourceMaterializationError: error.slice(0, 500) })),
      },
    });
  }
}

async function main() {
  const records = parseTemplateRegistry(JSON.parse(await fs.readFile(path.join(root, "templates.json"), "utf8")));
  const allowed = requestedRepositories();
  const candidates = [...new Map(records
    .filter((record) => ["A", "B"].includes(record.recommendationLevel ?? "") && ["latex", "overleaf", "typst"].includes(record.format.toLowerCase()))
    .map((record) => [sourceKey(record), record] as const)
    .filter(([key, record]) => key && (!allowed || allowed.has(key.replace(/^github:/, "")) || allowed.has(record.repositoryUrl ?? ""))))
    .values()];
  const selected = allowed ? candidates : candidates.slice(0, materializationLimit());
  const results: Array<Record<string, unknown>> = [];
  for (const record of selected) {
    const sourceUrl = record.repositoryUrl ?? "";
    try {
      const githubSlug = githubRepositorySlug(sourceUrl) ?? await discoverGithubRepository(sourceUrl);
      const typstPackage = githubSlug ? null : await discoverTypstPackage(sourceUrl);
      if (!githubSlug && !typstPackage) throw new Error(`来源页面未发现可固定的 GitHub 仓库或版本化 Typst 包：${sourceUrl}`);
      const slug = githubSlug ?? `typst-${typstPackage!.packageName}`;
      const commit = githubSlug ? await resolveCommit(githubSlug, record.version ?? null) : typstPackage!.version;
      const snapshot = githubSlug ? await downloadSnapshotWithSubmodules(githubSlug, commit) : await downloadTypstSnapshot(typstPackage!.archiveUrl);
      const updated = await updateVariants(records, record, slug, commit, snapshot);
      const result = { source: sourceUrl, slug, commit, ...(typstPackage ? { archiveUrl: typstPackage.archiveUrl } : {}), files: snapshot.files.length, bytes: snapshot.bytes, variants: updated };
      results.push(result);
      console.log(JSON.stringify({ completed: results.length, total: selected.length, ...result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const slug = githubRepositorySlug(sourceUrl);
      await markMaterializationFailure(records, record, slug, message);
      const result = { source: sourceUrl, ...(slug ? { slug } : {}), error: message };
      results.push(result);
      console.error(JSON.stringify({ completed: results.length, total: selected.length, ...result }));
    }
  }
  console.log(JSON.stringify({ root, selected: selected.length, results }, null, 2));
  if (results.some((result) => "error" in result)) process.exitCode = 1;
}

main().finally(async () => prisma.$disconnect());
