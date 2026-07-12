export type AgentRuntimeMode = "legacy" | "shadow" | "new";

type RuntimeEnvironment = Partial<
  Record<"AGENT_RUNTIME_MODE" | "AGENT_ORCHESTRATOR_ENABLED" | "NODE_ENV", string>
>;

const RUNTIME_MODES = new Set<AgentRuntimeMode>(["legacy", "shadow", "new"]);

/**
 * Resolve the Agent rollout mode without environment-dependent defaults.
 *
 * `AGENT_ORCHESTRATOR_ENABLED` remains a compatibility bridge while existing
 * deployments migrate to `AGENT_RUNTIME_MODE`; the explicit runtime mode always
 * wins when both variables are present.
 */
export function resolveAgentRuntimeMode(
  environment: RuntimeEnvironment = process.env
): AgentRuntimeMode {
  const configuredMode = environment.AGENT_RUNTIME_MODE?.trim();
  if (configuredMode) {
    if (!RUNTIME_MODES.has(configuredMode as AgentRuntimeMode)) {
      throw new Error(`Invalid AGENT_RUNTIME_MODE: ${configuredMode}`);
    }
    return configuredMode as AgentRuntimeMode;
  }

  if (environment.AGENT_ORCHESTRATOR_ENABLED === "1") return "new";
  if (environment.AGENT_ORCHESTRATOR_ENABLED === "0") return "legacy";

  return "legacy";
}
