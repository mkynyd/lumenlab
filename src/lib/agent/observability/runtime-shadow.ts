export interface RuntimeDecisionSnapshot {
  skillId: string | null;
  webSearchActive: boolean;
  plannedToolIds: string[];
}

export interface RuntimeShadowComparison {
  changed: boolean;
  differences: Array<keyof RuntimeDecisionSnapshot>;
  legacy: RuntimeDecisionSnapshot;
  candidate: RuntimeDecisionSnapshot;
}

/**
 * Compare pure planning decisions in shadow mode. Provider calls and tools are
 * intentionally excluded so shadow observation cannot duplicate cost or side
 * effects while the legacy response remains authoritative.
 */
export function compareRuntimeDecisions(input: {
  legacy: RuntimeDecisionSnapshot;
  candidate: RuntimeDecisionSnapshot;
}): RuntimeShadowComparison {
  const differences: Array<keyof RuntimeDecisionSnapshot> = [];
  if (input.legacy.skillId !== input.candidate.skillId) {
    differences.push("skillId");
  }
  if (input.legacy.webSearchActive !== input.candidate.webSearchActive) {
    differences.push("webSearchActive");
  }
  if (
    JSON.stringify(input.legacy.plannedToolIds) !==
    JSON.stringify(input.candidate.plannedToolIds)
  ) {
    differences.push("plannedToolIds");
  }
  return {
    changed: differences.length > 0,
    differences,
    legacy: input.legacy,
    candidate: input.candidate,
  };
}
