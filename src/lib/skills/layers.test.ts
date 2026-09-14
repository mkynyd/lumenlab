import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverEffectiveSkills, discoverManaged } from "./layers";

const roots: string[] = [];
const oldManaged = process.env.LUMENLAB_MANAGED_SKILLS_DIR;
const oldUser = process.env.LUMENLAB_USER_SKILLS_DIR;
const oldProject = process.env.LUMENLAB_PROJECT_SKILLS_DIR;

function root(name: string) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), `skills-${name}-`));
  roots.push(value);
  return value;
}

function writeSkill(base: string, source: "managed" | "user" | "project", marker: string) {
  const directory = path.join(base, "academic", "literature-review");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: literature-review\ndescription: Layer precedence regression skill.\n---\n\n# ${marker}\n\n${marker} methodology body remains observable.\n`);
  fs.writeFileSync(path.join(directory, "policy.json"), JSON.stringify({
    version: "9.0.0", category: "academic", display_name: marker, trust_level: source, enabled: true,
    allowed_tools: [], allowed_risk_level: ["L1"], default_approval_policy: "block", required_scopes: [],
    input_contract: {}, output_contract: {}, data_handling: { may_send_to_external: false, may_persist: false },
    triggers: { include: [], exclude: [] }, resources: { allow: [], deny: ["**/*"] },
  }));
  return directory;
}

afterEach(() => {
  if (oldManaged === undefined) delete process.env.LUMENLAB_MANAGED_SKILLS_DIR; else process.env.LUMENLAB_MANAGED_SKILLS_DIR = oldManaged;
  if (oldUser === undefined) delete process.env.LUMENLAB_USER_SKILLS_DIR; else process.env.LUMENLAB_USER_SKILLS_DIR = oldUser;
  if (oldProject === undefined) delete process.env.LUMENLAB_PROJECT_SKILLS_DIR; else process.env.LUMENLAB_PROJECT_SKILLS_DIR = oldProject;
  for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true });
});

describe("Skill source layers", () => {
  it("applies project > user > managed > bundled and exposes every override", async () => {
    const managed = root("managed");
    const user = root("user");
    const project = root("project");
    const managedVersion = path.join(managed, "versions", "literature-review", "hash");
    writeSkill(path.dirname(path.dirname(managedVersion)), "managed", "managed");
    const actualManaged = path.join(managed, "versions", "academic", "literature-review");
    fs.writeFileSync(path.join(managed, "skills.lock.json"), JSON.stringify({ schemaVersion: 1, installations: [{
      skillId: "literature-review", category: "academic", state: "active", currentPath: path.relative(managed, actualManaged),
    }] }));
    writeSkill(user, "user", "user");
    writeSkill(project, "project", "project");
    process.env.LUMENLAB_MANAGED_SKILLS_DIR = managed;
    process.env.LUMENLAB_USER_SKILLS_DIR = user;
    process.env.LUMENLAB_PROJECT_SKILLS_DIR = project;
    expect((await discoverManaged(managed)).map((item) => item.name)).toContain("literature-review");
    const result = await discoverEffectiveSkills();
    const skill = result.skills.find((item) => item.name === "literature-review");
    expect(skill?.source).toBe("project");
    expect(skill?.instructions).toContain("project methodology");
    expect(result.overrides).toContainEqual({
      skillId: "literature-review",
      activeSource: "project",
      overriddenSources: ["bundled", "managed", "user"],
    });
  });
});
