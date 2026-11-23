type EventIdentity = {
  messageId: string;
  attempt: number;
  round: number;
};

export type UIEvent = EventIdentity & (
  | { kind: "append"; from: number; revision: number; groups: string[] }
  | { kind: "reset" }
  | { kind: "commit"; revision: number; digest: string }
);

function integerInRange(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function readUIEvent(raw: unknown): UIEvent | null {
  // Validate the small SSE envelope without loading the UI catalog in the chat transport.
  if (raw === null || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Object.prototype) return null;
  const { kind, messageId, attempt, round, from, revision, groups, digest } = raw as Record<string, unknown>;
  if (typeof messageId !== "string" || messageId.length === 0 || messageId.length > 120 ||
      !integerInRange(attempt, 0) || !integerInRange(round, 0)) return null;
  const identity = { messageId, attempt, round };
  const keys = Object.keys(raw).length;

  if (kind === "reset") return keys === 4 ? { ...identity, kind } : null;
  if (!integerInRange(revision, 1, 8)) return null;
  if (kind === "commit" && keys === 6 && typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)) {
    return { ...identity, kind, revision, digest };
  }
  if (kind === "append" && keys === 7 && integerInRange(from, 0, 8) &&
      Array.isArray(groups) && groups.length >= 1 && groups.length <= 2 &&
      groups.every((entry) => typeof entry === "string" && entry.length <= 14 * 1024)) {
    return { ...identity, kind, from, revision, groups };
  }
  return null;
}
