import { getManagedSkillsUpdater } from "./managed-service";
import { nextSkillUpdateBackoff, nextSkillUpdateCheck, readManagedSkillsManifest } from "./managed-updater";
import { managedSkillsDirectory } from "./layers";

export type SchedulerSleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
  });
}

export function schedulerDelay(now: Date, dueAt: Date): number {
  const delta = dueAt.getTime() - now.getTime();
  return Number.isFinite(delta) ? Math.max(1_000, Math.min(60 * 60 * 1_000, delta)) : 60 * 60 * 1_000;
}

export class ManagedSkillsUpdateScheduler {
  private readonly stopController = new AbortController();
  private loop: Promise<void> | null = null;

  constructor(private readonly input: { now?: () => Date; sleep?: SchedulerSleep } = {}) {}

  start(): Promise<void> {
    this.loop ??= this.run().finally(() => { this.loop = null; });
    return this.loop;
  }

  async stop(): Promise<void> {
    this.stopController.abort();
    await this.loop;
  }

  private async run(): Promise<void> {
    const updater = getManagedSkillsUpdater();
    const root = managedSkillsDirectory();
    if (!updater || !root) return;
    const now = this.input.now ?? (() => new Date());
    const sleep = this.input.sleep ?? defaultSleep;
    while (!this.stopController.signal.aborted) {
      const current = now();
      let manifest;
      try {
        manifest = readManagedSkillsManifest(root);
      } catch {
        await sleep(schedulerDelay(current, nextSkillUpdateBackoff(current, "manifest", 1)), this.stopController.signal);
        continue;
      }
      const enabled = manifest.installations.filter((item) => item.autoUpdate && item.state !== "disabled");
      if (!enabled.length) {
        await sleep(schedulerDelay(current, nextSkillUpdateCheck(current, "empty")), this.stopController.signal);
        continue;
      }
      const due = enabled.filter((item) => !item.nextCheckAt || !Number.isFinite(Date.parse(item.nextCheckAt)) || new Date(item.nextCheckAt) <= current);
      if (due.length) {
        for (const installation of due) {
          if (this.stopController.signal.aborted) break;
          await updater.check(installation.skillId, true);
        }
        continue;
      }
      const next = new Date(Math.min(...enabled.map((item) => new Date(item.nextCheckAt!).getTime())));
      await sleep(schedulerDelay(current, next), this.stopController.signal);
    }
  }
}

let scheduler: ManagedSkillsUpdateScheduler | null = null;

export function startManagedSkillsUpdateScheduler(): { started: boolean; reason?: string } {
  if (process.env.LUMENLAB_SKILLS_AUTO_UPDATE === "false") return { started: false, reason: "disabled" };
  if (!managedSkillsDirectory()) return { started: false, reason: "managed_directory_not_configured" };
  if (!scheduler) {
    scheduler = new ManagedSkillsUpdateScheduler();
    void scheduler.start();
  }
  return { started: true };
}
