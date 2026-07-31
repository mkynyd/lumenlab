type Environment = Record<string, string | undefined>;

export type LearningLoopRollout = "off" | "preview" | "default";

export interface LearningFeatureFlags {
  rollout: LearningLoopRollout;
  durableExecutionEnabled: boolean;
  apiEnabled: boolean;
  navigationVisible: boolean;
  todayIsDefault: boolean;
}

export class LearningFeatureConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningFeatureConfigurationError";
  }
}

function parseRollout(value: string | undefined): LearningLoopRollout {
  if (value === undefined || value === "") return "off";
  if (value === "off" || value === "preview" || value === "default") {
    return value;
  }
  throw new LearningFeatureConfigurationError(
    `Invalid LEARNING_LOOP_ROLLOUT value: ${value}`
  );
}

export function buildLearningFeatureFlags(
  environment: Environment
): LearningFeatureFlags {
  const rollout = parseRollout(environment.LEARNING_LOOP_ROLLOUT);
  const durableExecutionEnabled =
    environment.AGENT_DURABLE_EXECUTION_ENABLED === "true";

  if (rollout === "default" && !durableExecutionEnabled) {
    throw new LearningFeatureConfigurationError(
      "LEARNING_LOOP_ROLLOUT=default requires AGENT_DURABLE_EXECUTION_ENABLED=true"
    );
  }

  return {
    rollout,
    durableExecutionEnabled,
    apiEnabled: rollout !== "off",
    navigationVisible: rollout !== "off",
    todayIsDefault: rollout === "default",
  };
}

export const learningFeatureFlags = buildLearningFeatureFlags(process.env);
