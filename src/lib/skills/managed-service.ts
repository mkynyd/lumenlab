import "@/lib/tools/registry";
import { toolRegistry } from "@/lib/agent/tool-registry";
import { refreshSkillDiscovery } from "./registry";
import { GitHubSkillTransport, ManagedSkillsUpdater } from "./managed-updater";
import { managedSkillsDirectory } from "./layers";

let singleton: ManagedSkillsUpdater | null = null;

export function getManagedSkillsUpdater(): ManagedSkillsUpdater | null {
  const root = managedSkillsDirectory();
  if (!root) return null;
  if (singleton) return singleton;
  const tools = toolRegistry.list();
  singleton = new ManagedSkillsUpdater({
    root,
    transport: new GitHubSkillTransport(),
    knownToolIds: new Set(tools.map((tool) => tool.toolId)),
    knownScopes: new Set(tools.flatMap((tool) => tool.requiredScopes)),
    onPromoted: async () => { await refreshSkillDiscovery(); },
  });
  return singleton;
}
