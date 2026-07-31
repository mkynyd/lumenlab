import { z } from "zod";

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_PAYLOAD_DEPTH = 12;
const MAX_PAYLOAD_NODES = 5_000;
const MAX_ARRAY_LENGTH = 500;
const MAX_OBJECT_KEYS = 200;
const MAX_STRING_LENGTH = 20_000;

const SECRET_KEY_PATTERN =
  /(?:authorization|cookie|api[_-]?key|token|secret|password|credential|continuation[_-]?handle)/i;

export type DurableJsonValue =
  | null
  | boolean
  | number
  | string
  | DurableJsonValue[]
  | { [key: string]: DurableJsonValue };

const durableAgentEventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    agentExecutionId: z.string().trim().min(1),
    sequence: z.number().int().positive(),
    type: z.string().trim().min(1).max(160),
    payload: z.unknown(),
  })
  .strict();

export interface DurableAgentEvent {
  schemaVersion: 1;
  agentExecutionId: string;
  sequence: number;
  type: string;
  payload: DurableJsonValue;
}

function assertDurableJsonPayload(value: unknown): asserts value is DurableJsonValue {
  const seen = new WeakSet<object>();
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_PAYLOAD_NODES) {
      throw new Error("Durable event payload exceeds the node limit.");
    }
    if (current.depth > MAX_PAYLOAD_DEPTH) {
      throw new Error("Durable event payload exceeds the depth limit.");
    }

    const item = current.value;
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      if (typeof item === "string" && item.length > MAX_STRING_LENGTH) {
        throw new Error("Durable event payload contains an oversized string.");
      }
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        throw new Error("Durable event payload contains a non-finite number.");
      }
      continue;
    }
    if (typeof item !== "object") {
      throw new Error("Durable event payload must be JSON-safe.");
    }
    if (seen.has(item)) {
      throw new Error("Durable event payload must not contain cycles.");
    }
    seen.add(item);

    if (Array.isArray(item)) {
      if (item.length > MAX_ARRAY_LENGTH) {
        throw new Error("Durable event payload contains an oversized array.");
      }
      for (const entry of item) {
        pending.push({ value: entry, depth: current.depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Durable event payload must contain plain objects only.");
    }
    const entries = Object.entries(item);
    if (entries.length > MAX_OBJECT_KEYS) {
      throw new Error("Durable event payload contains an oversized object.");
    }
    for (const [key, entry] of entries) {
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new Error(`Durable event payload contains a forbidden key: ${key}`);
      }
      pending.push({ value: entry, depth: current.depth + 1 });
    }
  }
}

export function parseDurableAgentEvent(value: unknown): DurableAgentEvent {
  const parsed = durableAgentEventEnvelopeSchema.parse(value);
  assertDurableJsonPayload(parsed.payload);
  const event = parsed as DurableAgentEvent;
  const serialized = JSON.stringify(event);
  if (new TextEncoder().encode(serialized).byteLength > MAX_EVENT_BYTES) {
    throw new Error("Durable event exceeds the encoded size limit.");
  }
  return event;
}

export const durableAgentEventSchema = {
  parse: parseDurableAgentEvent,
};

export function encodeDurableAgentEvent(event: DurableAgentEvent): string {
  return JSON.stringify(parseDurableAgentEvent(event));
}

export function decodeDurableAgentEvent(serialized: string): DurableAgentEvent {
  if (new TextEncoder().encode(serialized).byteLength > MAX_EVENT_BYTES) {
    throw new Error("Durable event exceeds the encoded size limit.");
  }
  return parseDurableAgentEvent(JSON.parse(serialized) as unknown);
}
