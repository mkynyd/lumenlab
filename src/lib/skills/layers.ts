import * as fs from "node:fs";
import * as path from "node:path";
import { buildCatalog, buildCatalogDescription, discoverAll, loadSkillFromDirectory, type DiscoveredSkill, type DiscoveryResult } from "./discovery";

export type SkillLayerSource = "bundled" | "managed" | "user" | "project";

interface ManagedManifestEntry {
  skillId: string;
  category: string;
  state: string;
  currentPath?: string | null;
}

interface ManagedManifest {
  installations?: ManagedManifestEntry[];
}

export interface EffectiveSkillDiscovery extends DiscoveryResult {
  overrides: Array<{ skillId: string; activeSource: SkillLayerSource; overriddenSources: SkillLayerSource[] }>;
}

export function bundledSkillsDirectory(): string {
  return path.join(process.cwd(), ".lumenlab", "skills");
}

export function managedSkillsDirectory(): string | null {
  const configured = process.env.LUMENLAB_MANAGED_SKILLS_DIR?.trim();
  return configured ? path.resolve(configured) : null;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function discoverManaged(root: string): Promise<DiscoveredSkill[]> {
  const canonicalRoot = fs.realpathSync(root);
  const manifestPath = path.join(canonicalRoot, "skills.lock.json");
  if (!fs.existsSync(manifestPath)) return [];
  let manifest: ManagedManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ManagedManifest;
  } catch {
    return [];
  }
  const skills: DiscoveredSkill[] = [];
  for (const entry of manifest.installations ?? []) {
    if (entry.state !== "active" || !entry.currentPath) continue;
    const skillDir = path.resolve(canonicalRoot, entry.currentPath);
    if (!isWithin(canonicalRoot, skillDir)) continue;
    try {
      const real = fs.realpathSync(skillDir);
      if (!isWithin(canonicalRoot, real)) continue;
      const loaded = await loadSkillFromDirectory(real, path.join(real, "SKILL.md"), entry.category || "uncategorized");
      if (loaded && loaded.name === entry.skillId) skills.push({ ...loaded, source: "managed" });
    } catch (error) {
      console.warn(`[SkillDiscovery] Managed skill ${entry.skillId} was excluded:`, error instanceof Error ? error.message : String(error));
    }
  }
  return skills;
}

async function discoverOptionalLayer(directory: string | undefined, source: "user" | "project"): Promise<DiscoveredSkill[]> {
  if (!directory?.trim()) return [];
  const root = path.resolve(directory);
  const result = await discoverAll(root);
  return result.skills.map((skill) => ({ ...skill, source }));
}

/** Precedence is project > user > managed > bundled. Every same-ID override is retained as observable metadata. */
export async function discoverEffectiveSkills(): Promise<EffectiveSkillDiscovery> {
  const bundled = await discoverAll(bundledSkillsDirectory());
  const managedRoot = managedSkillsDirectory();
  const layers: Array<{ source: SkillLayerSource; skills: DiscoveredSkill[] }> = [
    { source: "bundled", skills: bundled.skills.map((skill) => ({ ...skill, source: "bundled" })) },
    { source: "managed", skills: managedRoot ? await discoverManaged(managedRoot) : [] },
    { source: "user", skills: await discoverOptionalLayer(process.env.LUMENLAB_USER_SKILLS_DIR, "user") },
    { source: "project", skills: await discoverOptionalLayer(process.env.LUMENLAB_PROJECT_SKILLS_DIR, "project") },
  ];
  const effective = new Map<string, DiscoveredSkill>();
  const seen = new Map<string, SkillLayerSource[]>();
  for (const layer of layers) {
    for (const skill of layer.skills) {
      const prior = seen.get(skill.name) ?? [];
      seen.set(skill.name, [...prior, layer.source]);
      effective.set(skill.name, { ...skill, source: layer.source, overriddenSources: prior });
    }
  }
  const skills = [...effective.values()];
  const overrides = [...seen.entries()].filter(([, sources]) => sources.length > 1).map(([skillId, sources]) => ({
    skillId,
    activeSource: sources[sources.length - 1],
    overriddenSources: sources.slice(0, -1),
  }));
  const catalog = buildCatalog(skills, bundled.index);
  return {
    skills,
    catalog,
    catalogDescription: buildCatalogDescription(catalog),
    index: bundled.index,
    errors: bundled.errors,
    warnings: bundled.warnings,
    overrides,
  };
}
