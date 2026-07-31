import type { Prisma } from "@/generated/prisma/client";
import type {
  AgentExecutionEventRecord,
  AgentExecutionStore,
} from "./agent-execution-store";
import { AgentExecutionStoreError } from "./agent-execution-store";
import {
  parseDurableAgentEvent,
  type DurableAgentEvent,
} from "./event-codec";

type ReplayStore = Pick<
  AgentExecutionStore,
  "getOwnedExecution" | "listEventsAfter"
>;

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function jsonPayload(value: Prisma.JsonValue | null) {
  return (value ?? null) as DurableAgentEvent["payload"];
}

export function toDurableAgentEvent(
  event: AgentExecutionEventRecord
): DurableAgentEvent {
  return parseDurableAgentEvent({
    schemaVersion: 1,
    agentExecutionId: event.executionId,
    sequence: event.sequence,
    type: event.type,
    payload: jsonPayload(event.payload),
  });
}

function defaultSleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      finish();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function* replayAgentExecutionEvents(input: {
  store: ReplayStore;
  userId: string;
  executionId: string;
  afterSequence: number;
  signal?: AbortSignal;
  limit?: number;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}): AsyncGenerator<DurableAgentEvent> {
  let cursor = input.afterSequence;
  const limit = input.limit ?? 100;
  const pollIntervalMs = input.pollIntervalMs ?? 250;
  const sleep = input.sleep ?? defaultSleep;

  while (!input.signal?.aborted) {
    const records = await input.store.listEventsAfter({
      executionId: input.executionId,
      userId: input.userId,
      afterSequence: cursor,
      limit,
    });
    if (records === null) {
      throw new AgentExecutionStoreError(
        "execution_not_found",
        "AgentExecution does not exist"
      );
    }

    for (const record of records) {
      if (record.sequence <= cursor) continue;
      cursor = record.sequence;
      yield toDurableAgentEvent(record);
    }

    const execution = await input.store.getOwnedExecution({
      executionId: input.executionId,
      userId: input.userId,
    });
    if (!execution) {
      throw new AgentExecutionStoreError(
        "execution_not_found",
        "AgentExecution does not exist"
      );
    }
    if (
      TERMINAL_STATUSES.has(execution.status) &&
      cursor >= execution.lastEventSequence
    ) {
      return;
    }
    if (records.length >= limit) continue;
    await sleep(pollIntervalMs, input.signal);
  }
}
