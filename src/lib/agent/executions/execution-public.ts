import type { PublicAgentExecutionDto } from "./contracts";
import type { AgentExecutionRecord } from "./agent-execution-store";

function failureCode(execution: AgentExecutionRecord): string | null {
  const failure = execution.failure;
  return failure &&
    typeof failure === "object" &&
    !Array.isArray(failure) &&
    "code" in failure &&
    typeof failure.code === "string"
    ? failure.code
    : null;
}

export function toPublicAgentExecutionRecord(
  execution: AgentExecutionRecord
): PublicAgentExecutionDto {
  return {
    id: execution.id,
    conversationId: execution.conversationId,
    projectId: execution.projectId,
    status: execution.status,
    lastEventSequence: execution.lastEventSequence,
    attempt: execution.attempt,
    scheduledAt: execution.scheduledAt.toISOString(),
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
    failureCode: failureCode(execution),
  };
}
