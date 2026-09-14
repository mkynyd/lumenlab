import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubSkillTransport, ManagedSkillsUpdater, compareSkillSecurity, deterministicSkillUpdateJitter, nextSkillUpdateBackoff, readManagedSkillsManifest, skillUpdateIntervalMs, validateManagedSkillPackage, type ManagedSkillInstallation, type ManagedSkillSource, type SkillUpdateTransport } from "./managed-updater";
import type { SkillPolicy } from "./discovery";
import { schedulerDelay } from "./update-scheduler";

const roots: string[] = [];
const source: ManagedSkillSource = { type: "github", url: "https://github.com/example/skills", path: "skills/demo", channel: "main" };

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lumenlab-skills-"));
  roots.push(root);
  return root;
}

function policy(overrides: Partial<SkillPolicy> = {}): SkillPolicy {
  return {
    version: "1.0.0", category: "academic", display_name: "Demo", trust_level: "managed", enabled: true,
    allowed_tools: [], allowed_risk_level: ["L1"], default_approval_policy: "block", required_scopes: [],
    input_contract: {}, output_contract: {}, data_handling: { may_send_to_external: false, may_persist: false },
    triggers: { include: [], exclude: [] }, resources: { allow: [], deny: ["scripts/**"] }, ...overrides,
  };
}

function writePackage(directory: string, version: string, body: string, nextPolicy = policy({ version })) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: demo\ndescription: Managed test skill for safe updater behavior.\n---\n\n# Demo\n\n${body}\n`);
  fs.writeFileSync(path.join(directory, "policy.json"), `${JSON.stringify(nextPolicy, null, 2)}\n`);
}

function installation(): ManagedSkillInstallation {
  return {
    skillId: "demo", category: "academic", source, installedRevision: null, version: null,
    contentHash: null, policyHash: null, installedAt: null, lastCheckedAt: null, lastUpdatedAt: null,
    autoUpdate: true, state: "failed", currentPath: null, previous: null,
  };
}

function seed(root: string, item = installation()) {
  fs.writeFileSync(path.join(root, "skills.lock.json"), `${JSON.stringify({ schemaVersion: 1, installations: [item] }, null, 2)}\n`);
}

class QueueTransport implements SkillUpdateTransport {
  constructor(private readonly packages: Array<{ revision: string; version: string; body: string; policy?: SkillPolicy }>) {}
  async fetch(_source: ManagedSkillSource, directory: string) {
    const next = this.packages.shift();
    if (!next) throw new Error("transport_empty");
    writePackage(directory, next.version, next.body, next.policy);
    return { revision: next.revision, packageDirectory: directory };
  }
}

function updater(root: string, transport: SkillUpdateTransport) {
  return new ManagedSkillsUpdater({ root, transport, knownToolIds: new Set(["web.search"]), knownScopes: new Set(["project.read"]) });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Managed Skills Auto Update v1", () => {
  it("promotes safe instruction updates, preserves two versions, and rolls back atomically", async () => {
    const root = tempRoot();
    seed(root);
    const service = updater(root, new QueueTransport([
      { revision: "a", version: "1.0.0", body: "Initial safe methodology with enough detail for validation." },
      { revision: "b", version: "1.0.1", body: "Revised safe methodology with a corrected research instruction." },
    ]));
    expect(await service.check("demo", true)).toMatchObject([{ status: "promoted" }]);
    const first = readManagedSkillsManifest(root).installations[0];
    expect(first.currentPath).toContain("versions/demo/");
    expect(await service.check("demo", true)).toMatchObject([{ status: "promoted" }]);
    const second = readManagedSkillsManifest(root).installations[0];
    expect(second.version).toBe("1.0.1");
    expect(second.previous?.version).toBe("1.0.0");
    expect(await service.rollback("demo")).toMatchObject({ status: "promoted" });
    expect(readManagedSkillsManifest(root).installations[0].version).toBe("1.0.0");
  });

  it.each([
    ["allowed_tools_expanded", policy({ allowed_tools: ["web.search"] })],
    ["risk_level_raised", policy({ allowed_risk_level: ["L1", "L2"] })],
    ["required_scopes_expanded", policy({ required_scopes: ["project.read"] })],
    ["approval_loosened", policy({ default_approval_policy: "auto" })],
    ["external_access_enabled", policy({ data_handling: { may_send_to_external: true, may_persist: false } })],
    ["resource_access_expanded", policy({ resources: { allow: ["assets/**"], deny: ["scripts/**"] } })],
  ])("requires review when %s", (reason, next) => {
    const result = compareSkillSecurity(policy(), next, { valid: true, errors: [], warnings: [] });
    expect(result.safe).toBe(false);
    expect(result.reviewReasons).toContain(reason);
  });

  it("stages a security expansion without changing current", async () => {
    const root = tempRoot();
    seed(root);
    const service = updater(root, new QueueTransport([
      { revision: "a", version: "1.0.0", body: "Initial methodology with no runtime permissions." },
      { revision: "b", version: "1.1.0", body: "Now requests a tool.", policy: policy({ version: "1.1.0", allowed_tools: ["web.search"] }) },
    ]));
    await service.check("demo", true);
    const current = readManagedSkillsManifest(root).installations[0].contentHash;
    expect(await service.check("demo", true)).toMatchObject([{ status: "staged", reviewReasons: ["allowed_tools_expanded"] }]);
    const after = readManagedSkillsManifest(root).installations[0];
    expect(after.state).toBe("review_required");
    expect(after.contentHash).toBe(current);
    expect(await service.promoteStaged("demo")).toMatchObject({ status: "staged" });
    expect(await service.promoteStaged("demo", true)).toMatchObject({ status: "promoted" });
    expect(readManagedSkillsManifest(root).installations[0].version).toBe("1.1.0");
  });

  it("rejects symlinks", async () => {
    const root = tempRoot();
    const skill = path.join(root, "demo");
    writePackage(skill, "1.0.0", "Valid body", policy({ allowed_tools: ["unknown.tool"] }));
    fs.symlinkSync("SKILL.md", path.join(skill, "escape"));
    const invalid = await validateManagedSkillPackage({ packageDirectory: skill, expectedSkillId: "demo", category: "academic", knownToolIds: new Set(), knownScopes: new Set() });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(",")).toContain("symlink_not_allowed");
  });

  it("rejects oversized files, unknown tools, and traversal-like resource rules", async () => {
    const root = tempRoot();
    const skill = path.join(root, "demo");
    writePackage(skill, "1.0.0", "Valid body", policy({ allowed_tools: ["unknown.tool"], resources: { allow: ["../secret"], deny: [] } }));
    fs.writeFileSync(path.join(skill, "large.bin"), Buffer.alloc(256 * 1024 + 1));
    const invalid = await validateManagedSkillPackage({ packageDirectory: skill, expectedSkillId: "demo", category: "academic", knownToolIds: new Set(), knownScopes: new Set(), expectedTrust: "managed" });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining(["file_too_large:large.bin", "unknown_tool:unknown.tool", "invalid_resource_rule:../secret"]));
  });

  it("preserves current when a later transport fails and never promotes bundled upstream", async () => {
    const root = tempRoot();
    seed(root);
    const firstTransport = new QueueTransport([{ revision: "a", version: "1.0.0", body: "Initial safe methodology body." }]);
    await updater(root, firstTransport).check("demo", true);
    const before = readManagedSkillsManifest(root).installations[0];
    const failing = updater(root, { async fetch() { throw new Error("upstream_unavailable"); } });
    expect(await failing.check("demo", true)).toMatchObject([{ status: "failed" }]);
    expect(readManagedSkillsManifest(root).installations[0].contentHash).toBe(before.contentHash);

    const bundledRoot = tempRoot();
    const bundled = installation();
    bundled.source = { ...source, type: "bundled" };
    seed(bundledRoot, bundled);
    const bundledPolicy = policy({ trust_level: "builtin" });
    const bundledService = updater(bundledRoot, new QueueTransport([{ revision: "upstream", version: "1.0.1", body: "Bundled upstream candidate.", policy: bundledPolicy }]));
    expect(await bundledService.check("demo", true)).toMatchObject([{ status: "bundled_update_available" }]);
    expect(readManagedSkillsManifest(bundledRoot).installations[0].currentPath).toBeNull();
  });

  it("rejects a remote source path before attempting network access", async () => {
    const transport = new GitHubSkillTransport();
    await expect(transport.fetch({ ...source, path: "../escape" }, path.join(tempRoot(), "demo"))).rejects.toThrow("invalid_source_path");
  });

  it("uses a distributed file lease so only one concurrent check can promote", async () => {
    const root = tempRoot();
    seed(root);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transport: SkillUpdateTransport = {
      async fetch(_source, directory) {
        writePackage(directory, "1.0.0", "Concurrent safe methodology body.");
        await gate;
        return { revision: "a", packageDirectory: directory };
      },
    };
    const service = updater(root, transport);
    const first = service.check("demo", true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await service.check("demo", true)).toMatchObject([{ status: "locked" }]);
    release();
    expect(await first).toMatchObject([{ status: "promoted" }]);
  });

  it("has deterministic jitter, a one-hour polling floor, and bounded backoff", () => {
    expect(deterministicSkillUpdateJitter("demo")).toBe(deterministicSkillUpdateJitter("demo"));
    expect(skillUpdateIntervalMs("1000")).toBe(60 * 60 * 1_000);
    const now = new Date("2026-09-14T00:00:00Z");
    expect(nextSkillUpdateBackoff(now, "demo", 20).getTime() - now.getTime()).toBeLessThanOrEqual(6 * 60 * 60 * 1_000 + 5 * 60 * 1_000);
    expect(schedulerDelay(now, new Date("invalid"))).toBe(60 * 60 * 1_000);
  });
});
