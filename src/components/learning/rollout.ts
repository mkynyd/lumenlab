/**
 * Pure rollout-access helper for learning pages. Pages call this at request
 * time; invalid configuration fails closed (learning UI unavailable) instead
 * of throwing, mirroring the server route's fail-closed behavior.
 */

import {
  buildLearningFeatureFlags,
  type LearningLoopRollout,
} from "@/lib/learning/feature-flags";

export interface LearningPageFlags {
  available: boolean;
  rollout: LearningLoopRollout;
}

export function resolveLearningPageFlags(
  env: Record<string, string | undefined> = process.env
): LearningPageFlags {
  try {
    const flags = buildLearningFeatureFlags(env);
    return { available: flags.apiEnabled, rollout: flags.rollout };
  } catch {
    return { available: false, rollout: "off" };
  }
}
