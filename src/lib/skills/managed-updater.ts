import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseSkillMarkdown, validateSkill, loadSkillFromDirectory, type DiscoveredSkill, type SkillPolicy } from "./discovery";

export type ManagedSkillState = "active" | "update_available" | "review_required" | "failed" | "disabled";

export interface ManagedSkillSource {
  type: "github" | "git" | "agent_skills" | "bundled";
  url: string;
  path: string;
  channel: string;
}

export interface ManagedSkillVersionRef {
  version: string;
  revision: string;
  contentHash: string;
  policyHash: string;
  path: string;
}

export interface ManagedSkillInstallation {
  skillId: string;
  category: string;
  source: ManagedSkillSource;
  installedRevision: string | null;
  version: string | null;
  contentHash: string | null;
  policyHash: string | null;
  installedAt: string | null;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  autoUpdate: boolean;
  state: ManagedSkillState;
  currentPath: string | null;
  previous: ManagedSkillVersionRef | null;
  candidate?: ManagedSkillVersionRef | null;
  reviewReasons?: string[];
  reviewSummary?: string[];
  lastError?: string | null;
  nextCheckAt?: string | null;
}

export interface ManagedSkillsManifest {
  schemaVersion: 1;
  installations: ManagedSkillInstallation[];
}

export interface FetchedSkillPackage {
  revision: string;
  packageDirectory: string;
  rateLimitResetAt?: Date;
}

export interface SkillUpdateTransport {
  fetch(source: ManagedSkillSource, stagingDirectory: string): Promise<FetchedSkillPackage>;
}

export interface PackageValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  skill?: DiscoveredSkill;
  contentHash?: string;
  policyHash?: string;
  hasExecutable?: boolean;
}

export interface SecurityDiff {
  safe: boolean;
  reviewReasons: string[];
  summary: string[];
}

export interface UpdateResult {
  skillId: string;
  status: "unchanged" | "promoted" | "staged" | "failed" | "locked" | "bundled_update_available";
  reviewReasons?: string[];
  error?: string;
}

const MAX_FILES = 64;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MIN_INTERVAL_MS = 60 * 60 * 1_000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_JITTER_MS = 60 * 60 * 1_000;
const LEASE_STALE_MS = 30 * 60 * 1_000;
const ALLOWED_APPROVALS = new Set(["auto", "ask_first", "ask_each", "block"]);
const ALLOWED_RISKS = new Set(["L0", "L1", "L2", "L3", "L4"]);
const ALLOWED_TRUST = new Set(["builtin", "managed", "user", "project"]);
const SUSPICIOUS_INSTRUCTION = /(ignore|override|bypass|disregard).{0,40}(system|policy|safety|tool|schema|budget)|隐藏推理|泄露.{0,12}(密钥|secret)|扩大.{0,12}(附件|项目数据|权限)/i;

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function walkPackage(root: string): Array<{ relative: string; absolute: string; stat: fs.Stats }> {
  const output: Array<{ relative: string; absolute: string; stat: fs.Stats }> = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path_escape");
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`symlink_not_allowed:${relative}`);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) output.push({ relative: relative.split(path.sep).join("/"), absolute, stat });
      else throw new Error(`unsupported_file_type:${relative}`);
    }
  };
  visit(root);
  return output.sort((a, b) => a.relative.localeCompare(b.relative));
}

export async function validateManagedSkillPackage(input: {
  packageDirectory: string;
  expectedSkillId: string;
  category: string;
  knownToolIds: Set<string>;
  knownScopes: Set<string>;
  expectedTrust?: "managed" | "builtin";
  requireDirectoryNameMatch?: boolean;
}): Promise<PackageValidation> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = path.resolve(input.packageDirectory);
  let files: ReturnType<typeof walkPackage> = [];
  try {
    files = walkPackage(root);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : "invalid_package"], warnings };
  }
  if (files.length > MAX_FILES) errors.push(`file_count_exceeds_${MAX_FILES}`);
  let total = 0;
  let hasExecutable = false;
  for (const file of files) {
    total += file.stat.size;
    if (file.stat.size > MAX_FILE_BYTES) errors.push(`file_too_large:${file.relative}`);
    if ((file.stat.mode & 0o111) !== 0) hasExecutable = true;
    if (file.relative.startsWith("scripts/") || (file.stat.mode & 0o111) !== 0) errors.push(`executable_resource_not_allowed:${file.relative}`);
    if (path.isAbsolute(file.relative) || file.relative.split("/").includes("..")) errors.push(`invalid_path:${file.relative}`);
  }
  if (total > MAX_TOTAL_BYTES) errors.push(`package_too_large:${total}`);
  const skillPath = path.join(root, "SKILL.md");
  const policyPath = path.join(root, "policy.json");
  if (!fs.existsSync(skillPath)) errors.push("missing_SKILL.md");
  if (!fs.existsSync(policyPath)) errors.push("missing_policy.json");
  if (!fs.existsSync(skillPath) || !fs.existsSync(policyPath)) return { valid: false, errors, warnings, hasExecutable };
  const parsed = parseSkillMarkdown(fs.readFileSync(skillPath, "utf8"));
  if (!parsed) errors.push("invalid_frontmatter");
  if (parsed?.frontmatter.name !== input.expectedSkillId) errors.push("skill_identity_changed");
  if (input.requireDirectoryNameMatch !== false && path.basename(root) !== input.expectedSkillId) errors.push("skill_id_path_mismatch");
  let policy: SkillPolicy | null = null;
  try {
    policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) as SkillPolicy;
  } catch {
    errors.push("invalid_policy_json");
  }
  if (policy) {
    if (!/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(policy.version ?? "")) errors.push("invalid_version");
    if (policy.category !== input.category) errors.push("policy_category_mismatch");
    if (!ALLOWED_TRUST.has(policy.trust_level)) errors.push("invalid_trust_level");
    if (input.expectedTrust && policy.trust_level !== input.expectedTrust) errors.push("unexpected_trust_level");
    if (!Array.isArray(policy.allowed_tools)) errors.push("invalid_allowed_tools");
    else for (const toolId of policy.allowed_tools) if (!input.knownToolIds.has(toolId)) errors.push(`unknown_tool:${toolId}`);
    if (!Array.isArray(policy.allowed_risk_level) || policy.allowed_risk_level.some((risk) => !ALLOWED_RISKS.has(risk))) errors.push("invalid_risk_level");
    if (!ALLOWED_APPROVALS.has(policy.default_approval_policy)) errors.push("invalid_approval_policy");
    if (!Array.isArray(policy.required_scopes) || policy.required_scopes.some((scope) => !input.knownScopes.has(scope))) errors.push("invalid_required_scope");
    if (!Array.isArray(policy.resources?.allow) || !Array.isArray(policy.resources?.deny)) errors.push("invalid_resource_rules");
    for (const rule of [...(Array.isArray(policy.resources?.allow) ? policy.resources.allow : []), ...(Array.isArray(policy.resources?.deny) ? policy.resources.deny : [])]) {
      if (path.isAbsolute(rule) || rule.split(/[\\/]/).includes("..")) errors.push(`invalid_resource_rule:${rule}`);
    }
  }
  if (errors.length || !policy) return { valid: false, errors, warnings, hasExecutable };
  const skill = await loadSkillFromDirectory(root, skillPath, input.category);
  if (!skill) return { valid: false, errors: ["skill_discovery_failed"], warnings, hasExecutable };
  const validation = validateSkill(skill);
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);
  if (SUSPICIOUS_INSTRUCTION.test(skill.instructions)) warnings.push("suspicious_policy_override_instruction");
  const contentMaterial = files.map((file) => `${file.relative}\0${hash(fs.readFileSync(file.absolute))}`).join("\n");
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    skill: { ...skill, source: "managed" },
    contentHash: hash(contentMaterial),
    policyHash: hash(stableJson(policy)),
    hasExecutable,
  };
}

function maxRisk(policy: SkillPolicy): number {
  return Math.max(0, ...policy.allowed_risk_level.map((risk) => Number(risk.slice(1)) || 0));
}

export function compareSkillSecurity(previous: SkillPolicy | null, next: SkillPolicy, validation: PackageValidation): SecurityDiff {
  const reasons: string[] = [];
  const summary: string[] = [];
  if (!validation.valid) reasons.push("validation_failed");
  if (validation.hasExecutable) reasons.push("executable_added");
  if (validation.warnings.includes("suspicious_policy_override_instruction")) reasons.push("suspicious_instruction");
  if (!previous) {
    if (next.allowed_tools.length) reasons.push("initial_tool_grant");
    if (next.required_scopes.length) reasons.push("initial_scope_grant");
    if (next.data_handling.may_send_to_external) reasons.push("initial_external_access");
  } else {
    const addedTools = next.allowed_tools.filter((tool) => !previous.allowed_tools.includes(tool));
    if (addedTools.length) {
      reasons.push("allowed_tools_expanded");
      summary.push(`新增工具：${addedTools.join("、")}`);
    }
    if (maxRisk(next) > maxRisk(previous)) {
      reasons.push("risk_level_raised");
      summary.push(`风险上限：L${maxRisk(previous)} → L${maxRisk(next)}`);
    }
    const scopes = next.required_scopes.filter((scope) => !previous.required_scopes.includes(scope));
    if (scopes.length) {
      reasons.push("required_scopes_expanded");
      summary.push(`新增 scope：${scopes.join("、")}`);
    }
    const approvalRank: Record<string, number> = { block: 0, ask_each: 1, ask_first: 2, auto: 3 };
    if ((approvalRank[next.default_approval_policy] ?? 99) > (approvalRank[previous.default_approval_policy] ?? -1)) {
      reasons.push("approval_loosened");
      summary.push(`审批策略：${previous.default_approval_policy} → ${next.default_approval_policy}`);
    }
    if (!previous.data_handling.may_send_to_external && next.data_handling.may_send_to_external) {
      reasons.push("external_access_enabled");
      summary.push("允许向外部发送数据");
    }
    const addedResources = (next.resources?.allow ?? []).filter((rule) => !(previous.resources?.allow ?? []).includes(rule));
    const removedDenies = (previous.resources?.deny ?? []).filter((rule) => !(next.resources?.deny ?? []).includes(rule));
    if (addedResources.length || removedDenies.length) {
      reasons.push("resource_access_expanded");
      summary.push("资源访问范围扩大");
    }
    if (previous.trust_level !== next.trust_level) {
      reasons.push("trust_level_changed");
      summary.push(`trust：${previous.trust_level} → ${next.trust_level}`);
    }
  }
  return { safe: reasons.length === 0, reviewReasons: [...new Set(reasons)], summary };
}

function emptyManifest(): ManagedSkillsManifest {
  return { schemaVersion: 1, installations: [] };
}

export function readManagedSkillsManifest(root: string): ManagedSkillsManifest {
  const file = path.join(root, "skills.lock.json");
  if (!fs.existsSync(file)) return emptyManifest();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ManagedSkillsManifest;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.installations)) throw new Error("invalid_managed_skills_manifest");
  return parsed;
}

function writeManifest(root: string, manifest: ManagedSkillsManifest): void {
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, "skills.lock.json");
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function readPolicy(directory: string | null, root: string): SkillPolicy | null {
  if (!directory) return null;
  const absolute = path.resolve(root, directory);
  if (!within(root, absolute)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(absolute, "policy.json"), "utf8")) as SkillPolicy;
  } catch {
    return null;
  }
}

function acquireLease(root: string, now: Date): (() => void) | null {
  fs.mkdirSync(root, { recursive: true });
  const lock = path.join(root, ".update.lease");
  try {
    const descriptor = fs.openSync(lock, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ owner: `${os.hostname()}:${process.pid}`, acquiredAt: now.toISOString() }));
    fs.closeSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      if (now.getTime() - fs.statSync(lock).mtimeMs > LEASE_STALE_MS) {
        fs.unlinkSync(lock);
        return acquireLease(root, now);
      }
    } catch {
      return null;
    }
    return null;
  }
  return () => {
    try { fs.unlinkSync(lock); } catch { /* lease already expired/removed */ }
  };
}

function versionRef(installation: ManagedSkillInstallation): ManagedSkillVersionRef | null {
  if (!installation.currentPath || !installation.version || !installation.installedRevision || !installation.contentHash || !installation.policyHash) return null;
  return {
    version: installation.version,
    revision: installation.installedRevision,
    contentHash: installation.contentHash,
    policyHash: installation.policyHash,
    path: installation.currentPath,
  };
}

export class ManagedSkillsUpdater {
  constructor(private readonly options: {
    root: string;
    transport: SkillUpdateTransport;
    knownToolIds: Set<string>;
    knownScopes: Set<string>;
    now?: () => Date;
    onPromoted?: () => Promise<void>;
  }) {}

  status(): ManagedSkillsManifest {
    return readManagedSkillsManifest(this.options.root);
  }

  async check(skillId?: string, promoteSafe = false): Promise<UpdateResult[]> {
    const now = (this.options.now ?? (() => new Date()))();
    const release = acquireLease(this.options.root, now);
    if (!release) return [{ skillId: skillId ?? "*", status: "locked" }];
    try {
      const manifest = readManagedSkillsManifest(this.options.root);
      const targets = manifest.installations.filter((item) => !skillId || item.skillId === skillId);
      const results: UpdateResult[] = [];
      for (const installation of targets) {
        results.push(await this.checkOne(manifest, installation, now, promoteSafe));
      }
      writeManifest(this.options.root, manifest);
      return results;
    } finally {
      release();
    }
  }

  private async checkOne(manifest: ManagedSkillsManifest, installation: ManagedSkillInstallation, now: Date, promoteSafe: boolean): Promise<UpdateResult> {
    const stagingRoot = path.join(this.options.root, "staging", `${installation.skillId}-${randomUUID()}`);
    const packageDirectory = path.join(stagingRoot, installation.skillId);
    fs.mkdirSync(packageDirectory, { recursive: true });
    installation.lastCheckedAt = now.toISOString();
    try {
      const fetched = await this.options.transport.fetch(installation.source, packageDirectory);
      if (fetched.revision === installation.installedRevision) {
        installation.state = installation.currentPath ? "active" : installation.state;
        installation.lastError = null;
        installation.nextCheckAt = nextSkillUpdateCheck(now, installation.skillId).toISOString();
        fs.rmSync(stagingRoot, { recursive: true, force: true });
        return { skillId: installation.skillId, status: "unchanged" };
      }
      const validation = await validateManagedSkillPackage({
        packageDirectory: fetched.packageDirectory,
        expectedSkillId: installation.skillId,
        category: installation.category,
        knownToolIds: this.options.knownToolIds,
        knownScopes: this.options.knownScopes,
        expectedTrust: installation.source.type === "bundled" ? "builtin" : "managed",
      });
      if (!validation.valid || !validation.skill || !validation.contentHash || !validation.policyHash) {
        throw new Error(validation.errors.join(",") || "package_validation_failed");
      }
      if (validation.contentHash === installation.contentHash) {
        installation.installedRevision = fetched.revision;
        installation.state = installation.currentPath ? "active" : installation.state;
        installation.lastError = null;
        installation.nextCheckAt = nextSkillUpdateCheck(now, installation.skillId).toISOString();
        fs.rmSync(stagingRoot, { recursive: true, force: true });
        return { skillId: installation.skillId, status: "unchanged" };
      }
      const security = compareSkillSecurity(readPolicy(installation.currentPath, this.options.root), validation.skill.policy, validation);
      const versionDirectory = path.join(this.options.root, "versions", installation.skillId, validation.contentHash);
      fs.mkdirSync(path.dirname(versionDirectory), { recursive: true });
      if (!fs.existsSync(versionDirectory)) fs.renameSync(fetched.packageDirectory, versionDirectory);
      const candidate: ManagedSkillVersionRef = {
        version: validation.skill.version,
        revision: fetched.revision,
        contentHash: validation.contentHash,
        policyHash: validation.policyHash,
        path: path.relative(this.options.root, versionDirectory),
      };
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      installation.candidate = candidate;
      installation.reviewReasons = security.reviewReasons;
      installation.reviewSummary = security.summary;
      installation.lastError = null;
      if (installation.source.type === "bundled") {
        installation.state = "update_available";
        return { skillId: installation.skillId, status: "bundled_update_available" };
      }
      if (!security.safe || !installation.autoUpdate || !promoteSafe) {
        installation.state = security.safe ? "update_available" : "review_required";
        return { skillId: installation.skillId, status: "staged", reviewReasons: security.reviewReasons };
      }
      await this.promote(manifest, installation, candidate, now);
      return { skillId: installation.skillId, status: "promoted" };
    } catch (error) {
      installation.state = installation.currentPath ? "active" : "failed";
      installation.lastError = error instanceof Error ? error.message.slice(0, 500) : "update_failed";
      installation.nextCheckAt = nextSkillUpdateBackoff(now, installation.skillId, 1).toISOString();
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      return { skillId: installation.skillId, status: "failed", error: installation.lastError };
    }
  }

  async promoteStaged(skillId: string, reviewed = false): Promise<UpdateResult> {
    const now = (this.options.now ?? (() => new Date()))();
    const release = acquireLease(this.options.root, now);
    if (!release) return { skillId, status: "locked" };
    try {
      const manifest = readManagedSkillsManifest(this.options.root);
      const installation = manifest.installations.find((item) => item.skillId === skillId);
      if (!installation?.candidate) return { skillId, status: "failed", error: "no_staged_candidate" };
      if (installation.state === "review_required" && !reviewed) return { skillId, status: "staged", reviewReasons: installation.reviewReasons };
      const candidateDirectory = path.resolve(this.options.root, installation.candidate.path);
      if (!within(this.options.root, candidateDirectory)) return { skillId, status: "failed", error: "candidate_path_escape" };
      const validation = await validateManagedSkillPackage({
        packageDirectory: candidateDirectory,
        expectedSkillId: installation.skillId,
        category: installation.category,
        knownToolIds: this.options.knownToolIds,
        knownScopes: this.options.knownScopes,
        expectedTrust: installation.source.type === "bundled" ? "builtin" : "managed",
        requireDirectoryNameMatch: false,
      });
      if (!validation.valid || validation.contentHash !== installation.candidate.contentHash || validation.policyHash !== installation.candidate.policyHash) {
        return { skillId, status: "failed", error: "staged_candidate_changed_or_invalid" };
      }
      await this.promote(manifest, installation, installation.candidate, now);
      writeManifest(this.options.root, manifest);
      return { skillId, status: "promoted" };
    } finally {
      release();
    }
  }

  private async promote(manifest: ManagedSkillsManifest, installation: ManagedSkillInstallation, candidate: ManagedSkillVersionRef, now: Date): Promise<void> {
    const previous = versionRef(installation);
    installation.previous = previous;
    installation.currentPath = candidate.path;
    installation.installedRevision = candidate.revision;
    installation.version = candidate.version;
    installation.contentHash = candidate.contentHash;
    installation.policyHash = candidate.policyHash;
    installation.installedAt ??= now.toISOString();
    installation.lastUpdatedAt = now.toISOString();
    installation.state = "active";
    installation.candidate = null;
    installation.reviewReasons = [];
    installation.reviewSummary = [];
    installation.nextCheckAt = nextSkillUpdateCheck(now, installation.skillId).toISOString();
    writeManifest(this.options.root, manifest);
    await this.options.onPromoted?.();
  }

  async rollback(skillId: string): Promise<UpdateResult> {
    const now = (this.options.now ?? (() => new Date()))();
    const release = acquireLease(this.options.root, now);
    if (!release) return { skillId, status: "locked" };
    try {
      const manifest = readManagedSkillsManifest(this.options.root);
      const installation = manifest.installations.find((item) => item.skillId === skillId);
      if (!installation?.previous) return { skillId, status: "failed", error: "no_previous_version" };
      const current = versionRef(installation);
      const previous = installation.previous;
      installation.currentPath = previous.path;
      installation.installedRevision = previous.revision;
      installation.version = previous.version;
      installation.contentHash = previous.contentHash;
      installation.policyHash = previous.policyHash;
      installation.previous = current;
      installation.state = "active";
      installation.lastUpdatedAt = now.toISOString();
      writeManifest(this.options.root, manifest);
      await this.options.onPromoted?.();
      return { skillId, status: "promoted" };
    } finally {
      release();
    }
  }
}

export function deterministicSkillUpdateJitter(skillId: string, maximumMs = MAX_JITTER_MS): number {
  const value = createHash("sha256").update(skillId).digest().readUInt32BE(0);
  return maximumMs <= 0 ? 0 : value % maximumMs;
}

export function skillUpdateIntervalMs(value = process.env.LUMENLAB_SKILLS_UPDATE_INTERVAL_MS): number {
  const parsed = value ? Number(value) : DEFAULT_INTERVAL_MS;
  return Number.isFinite(parsed) ? Math.max(MIN_INTERVAL_MS, parsed) : DEFAULT_INTERVAL_MS;
}

export function nextSkillUpdateCheck(now: Date, key: string, intervalMs = skillUpdateIntervalMs()): Date {
  return new Date(now.getTime() + Math.max(MIN_INTERVAL_MS, intervalMs) + deterministicSkillUpdateJitter(key));
}

export function nextSkillUpdateBackoff(now: Date, key: string, attempt: number): Date {
  const bounded = Math.min(6 * 60 * 60 * 1_000, 15 * 60 * 1_000 * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + bounded + deterministicSkillUpdateJitter(key, 5 * 60 * 1_000));
}

export class GitHubSkillTransport implements SkillUpdateTransport {
  constructor(private readonly token = process.env.GITHUB_TOKEN?.trim()) {}

  async fetch(source: ManagedSkillSource, stagingDirectory: string): Promise<FetchedSkillPackage> {
    const match = source.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/?$/i);
    if (!match) throw new Error("invalid_github_repository_url");
    const sourcePath = source.path.replace(/^\/+|\/+$/g, "");
    if (!sourcePath || sourcePath.split("/").includes("..")) throw new Error("invalid_source_path");
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const api = `https://api.github.com/repos/${match[1]}/${match[2]}`;
    const commitResponse = await fetch(`${api}/commits/${encodeURIComponent(source.channel || "main")}`, { headers });
    if (commitResponse.status === 403 || commitResponse.status === 429) throw new Error(`github_rate_limited:${commitResponse.headers.get("x-ratelimit-reset") ?? "unknown"}`);
    if (!commitResponse.ok) throw new Error(`github_commit_http_${commitResponse.status}`);
    const commit = await commitResponse.json() as { sha?: string; commit?: { tree?: { sha?: string } } };
    if (!commit.sha || !commit.commit?.tree?.sha) throw new Error("invalid_github_commit_response");
    const treeResponse = await fetch(`${api}/git/trees/${commit.commit.tree.sha}?recursive=1`, { headers });
    if (!treeResponse.ok) throw new Error(`github_tree_http_${treeResponse.status}`);
    const tree = await treeResponse.json() as { truncated?: boolean; tree?: Array<{ path?: string; type?: string; mode?: string; url?: string }> };
    if (tree.truncated) throw new Error("github_tree_truncated");
    const files = (tree.tree ?? []).filter((entry) => entry.type === "blob" && entry.path?.startsWith(`${sourcePath}/`));
    if (files.length > MAX_FILES) throw new Error("remote_file_count_exceeded");
    for (const entry of files) {
      if (entry.mode === "120000" || entry.mode === "100755") throw new Error(`remote_executable_or_symlink:${entry.path}`);
      const relative = entry.path!.slice(sourcePath.length + 1);
      if (!relative || relative.split("/").includes("..") || path.isAbsolute(relative)) throw new Error("remote_path_escape");
      const response = await fetch(entry.url!, { headers: { ...headers, Accept: "application/vnd.github.raw+json" } });
      if (!response.ok) throw new Error(`github_blob_http_${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_FILE_BYTES) throw new Error(`remote_file_too_large:${relative}`);
      const target = path.join(stagingDirectory, relative);
      if (!within(stagingDirectory, target)) throw new Error("remote_path_escape");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { mode: 0o600 });
    }
    return { revision: commit.sha, packageDirectory: stagingDirectory };
  }
}
