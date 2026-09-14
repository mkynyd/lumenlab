import { getManagedSkillsUpdater } from "../src/lib/skills/managed-service";

async function main() {
  const [command = "status", skillId] = process.argv.slice(2);
  const updater = getManagedSkillsUpdater();
  if (!updater) throw new Error("LUMENLAB_MANAGED_SKILLS_DIR is not configured");
  if (command === "status") {
    process.stdout.write(`${JSON.stringify(updater.status(), null, 2)}\n`);
    return;
  }
  if (command === "check") {
    process.stdout.write(`${JSON.stringify(await updater.check(skillId, false), null, 2)}\n`);
    return;
  }
  if (command === "update") {
    process.stdout.write(`${JSON.stringify(await updater.check(skillId, true), null, 2)}\n`);
    return;
  }
  if (command === "rollback" && skillId) {
    process.stdout.write(`${JSON.stringify(await updater.rollback(skillId), null, 2)}\n`);
    return;
  }
  if (command === "approve" && skillId) {
    process.stdout.write(`${JSON.stringify(await updater.promoteStaged(skillId, true), null, 2)}\n`);
    return;
  }
  throw new Error("Usage: npx tsx scripts/skills-managed.ts status|check [skillId]|update [skillId]|rollback <skillId>");
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
