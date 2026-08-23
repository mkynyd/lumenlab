import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer } from "@/lib/storage/object-storage";
import { normalizeTemplateManifest, parseTemplateRegistry, type TemplateRegistryRecord } from "@/lib/paper/template-registry";
import { githubRepositorySlug, normalizeTemplateZip } from "@/lib/paper/template-snapshot";

const root = process.env.TEMPLATE_REGISTRY_ROOT
  ? path.resolve(process.env.TEMPLATE_REGISTRY_ROOT)
  : path.resolve(process.cwd(), "resources/cn-thesis-templates");

function requestedRepositories(): Set<string> | null {
  const value = process.env.TEMPLATE_MATERIALIZE_REPOSITORIES?.trim();
  if (!value) return null;
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
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

async function resolveCommit(slug: string, requestedVersion: string | null): Promise<string> {
  if (requestedVersion && /^[0-9a-f]{7,40}$/i.test(requestedVersion)) return requestedVersion;
  const response = await fetchWithTimeout(`https://api.github.com/repos/${slug}/commits?per_page=1`);
  if (!response.ok) throw new Error(`GitHub commit 查询失败：${slug} (${response.status})`);
  const payload = await response.json() as Array<{ sha?: unknown }>;
  const sha = payload[0]?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`GitHub commit 响应无有效 SHA：${slug}`);
  return sha;
}

async function downloadSnapshot(slug: string, commit: string) {
  const response = await fetchWithTimeout(`https://api.github.com/repos/${slug}/zipball/${commit}`);
  if (!response.ok) throw new Error(`GitHub snapshot 下载失败：${slug}@${commit} (${response.status})`);
  const archive = Buffer.from(await response.arrayBuffer());
  return normalizeTemplateZip(archive);
}

async function updateVariants(records: TemplateRegistryRecord[], slug: string, commit: string, snapshot: Awaited<ReturnType<typeof downloadSnapshot>>) {
  const matching = records.filter((record) => githubRepositorySlug(record.repositoryUrl ?? "") === slug);
  const sourceArchive = await uploadObjectBuffer({
    key: `template-snapshots/${slug.replace("/", "__")}/${commit}.zip`,
    mimeType: "application/zip",
    buffer: snapshot.buffer,
  });
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
        validation: JSON.parse(JSON.stringify({ ...(variant.validation && typeof variant.validation === "object" ? variant.validation : {}), sourceMaterializedAt: new Date().toISOString(), sourceCommit: commit })),
      },
    });
    updated += 1;
  }
  return updated;
}

async function main() {
  const records = parseTemplateRegistry(JSON.parse(await fs.readFile(path.join(root, "templates.json"), "utf8")));
  const allowed = requestedRepositories();
  const candidates = [...new Map(records
    .filter((record) => ["A", "B"].includes(record.recommendationLevel ?? "") && ["latex", "overleaf", "typst"].includes(record.format.toLowerCase()))
    .map((record) => [githubRepositorySlug(record.repositoryUrl ?? ""), record] as const)
    .filter(([slug]) => slug && (!allowed || allowed.has(slug))))
    .values()];
  const selected = allowed ? candidates : candidates.slice(0, materializationLimit());
  const results: Array<Record<string, unknown>> = [];
  for (const record of selected) {
    const slug = githubRepositorySlug(record.repositoryUrl ?? "");
    if (!slug) continue;
    try {
      const commit = await resolveCommit(slug, record.version ?? null);
      const snapshot = await downloadSnapshot(slug, commit);
      const updated = await updateVariants(records, slug, commit, snapshot);
      results.push({ slug, commit, files: snapshot.files.length, bytes: snapshot.bytes, variants: updated });
    } catch (error) {
      results.push({ slug, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ root, selected: selected.length, results }, null, 2));
  if (results.some((result) => "error" in result)) process.exitCode = 1;
}

main().finally(async () => prisma.$disconnect());
