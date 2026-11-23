import type { UIEvent } from "./events";
import {
  MAX_GROUP_BYTES, MAX_GROUPS, MAX_SNAPSHOT_BYTES, UI_CATALOG_VERSION, UI_SCHEMA_VERSION,
  makeSurface, withinBudget, type UIGroup, type UISurface,
} from "./surface-data";

type Commit = Extract<UIEvent, { kind: "commit" }>;
interface Preview {
  attempt: number;
  round: number;
  surface: UISurface | undefined;
  committed: boolean;
  reset?: true;
}

export class ChatUIStream {
  private previews = new Map<string, Preview>();
  private listeners = new Map<string, Set<() => void>>();

  get(messageId: string) {
    return this.previews.get(messageId)?.surface;
  }

  generation(messageId: string) {
    const preview = this.previews.get(messageId);
    return preview ? `${preview.attempt}:${preview.round}` : "archive";
  }

  subscribe(messageId: string, listener: () => void) {
    if (!this.listeners.has(messageId)) this.listeners.set(messageId, new Set());
    this.listeners.get(messageId)?.add(listener);
    return () => {
      const set = this.listeners.get(messageId);
      set?.delete(listener);
      if (!set?.size) this.listeners.delete(messageId);
    };
  }

  accept(event: Exclude<UIEvent, Commit>, active: () => boolean = () => true) {
    if (!active()) return;
    const current = this.previews.get(event.messageId);
    if (current && (current.committed || event.attempt < current.attempt ||
      (event.attempt === current.attempt && event.round < current.round))) return;
    const sameRound = current?.attempt === event.attempt && current.round === event.round;
    if (event.kind === "reset") {
      this.publish(event.messageId, { ...event, surface: undefined, committed: false, reset: true });
      return;
    }
    if (sameRound && current?.reset) return;
    const previous = sameRound ? current?.surface?.groups ?? [] : [];
    if (event.from !== previous.length || event.revision !== event.from + event.groups.length || event.revision > MAX_GROUPS) return;
    const groups = [...previous];
    try {
      for (const entry of event.groups) {
        if (entry.length > MAX_GROUP_BYTES) return;
        const group: unknown = JSON.parse(entry);
        if (!hasGroupEnvelope(group) || groups.some(({ id }) => id === group.id) || !withinBudget(group, MAX_GROUP_BYTES)) return;
        groups.push(group);
      }
    } catch {
      return;
    }
    const surface = makeSurface(event.messageId, groups);
    if (withinBudget(surface, MAX_SNAPSHOT_BYTES)) {
      this.publish(event.messageId, { attempt: event.attempt, round: event.round, committed: false, surface });
    }
  }

  discard(messageId: string) {
    if (this.previews.get(messageId)?.committed) return;
    this.publish(messageId, undefined);
  }

  async commit(event: Commit, load: () => Promise<unknown>, active: () => boolean) {
    const preview = this.previews.get(event.messageId);
    let surface = preview?.surface;
    if (!surface || preview?.attempt !== event.attempt || preview?.round !== event.round ||
      surface.groups.length !== event.revision || !await matchesDigest(surface, event.digest)) {
      const saved = await load().catch(() => undefined);
      surface = hasSurfaceEnvelope(saved) && withinBudget(saved, MAX_SNAPSHOT_BYTES) ? saved : undefined;
      if (surface?.surfaceId !== event.messageId || surface.groups.length !== event.revision ||
        !await matchesDigest(surface, event.digest)) {
        if (active()) this.discard(event.messageId);
        return;
      }
    }
    if (active()) this.publish(event.messageId, { ...event, surface, committed: true });
  }

  clear() {
    for (const id of this.previews.keys()) this.publish(id, undefined);
  }

  private publish(id: string, preview: Preview | undefined) {
    const previous = this.previews.get(id)?.surface;
    if (preview) this.previews.set(id, preview);
    else this.previews.delete(id);
    if (previous !== preview?.surface) this.listeners.get(id)?.forEach((listener) => listener());
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

// Only authenticated execution events and history DTOs supply published data.
// The server validates component props, bindings and actions before either can expose it.
function hasGroupEnvelope(value: unknown): value is UIGroup {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    Array.isArray(value.nodes) && value.nodes.length >= 1 && value.nodes.length <= 24 &&
    (value.state === undefined || (Array.isArray(value.state) && value.state.length <= 12)) &&
    Object.keys(value).length === (value.state === undefined ? 2 : 3);
}

function hasSurfaceEnvelope(value: unknown): value is UISurface {
  return isRecord(value) && value.schemaVersion === UI_SCHEMA_VERSION && value.catalogVersion === UI_CATALOG_VERSION &&
    typeof value.surfaceId === "string" && Array.isArray(value.groups) && value.groups.length >= 1 &&
    value.groups.length <= MAX_GROUPS && value.groups.every(hasGroupEnvelope) && Object.keys(value).length === 4;
}

async function matchesDigest(surface: UISurface, expected: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return true;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(surface)));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("") === expected;
}
