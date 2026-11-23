import type { UISurface } from "./catalog";

const loadCatalog = () => import("./catalog");
import type { UIEvent } from "./events";

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

  async accept(event: Exclude<UIEvent, Commit>, active: () => boolean = () => true) {
    const catalog = event.kind === "append" ? await loadCatalog() : undefined;
    if (!active()) return;
    const current = this.previews.get(event.messageId);
    if (current && (current.committed || event.attempt < current.attempt ||
      (event.attempt === current.attempt && event.round < current.round))) return;
    const sameRound = current?.attempt === event.attempt && current.round === event.round;
    if (event.kind === "reset") {
      this.publish(event.messageId, { ...event, surface: undefined, committed: false, reset: true });
      return;
    }
    if (!catalog || (sameRound && current?.reset)) return;
    const previous = sameRound ? current?.surface?.groups ?? [] : [];
    if (event.from !== previous.length || event.revision !== event.from + event.groups.length) return;
    const groups = [...previous];
    try {
      for (const entry of event.groups) {
        const group = catalog.readUIGroup(JSON.parse(entry), groups);
        if (!group) return;
        groups.push(group);
      }
    } catch {
      return;
    }
    this.publish(event.messageId, {
      attempt: event.attempt, round: event.round, committed: false, surface: catalog.makeSurface(event.messageId, groups),
    });
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
      const { readUISurface } = await loadCatalog();
      surface = readUISurface(await load().catch(() => undefined)) ?? undefined;
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

async function matchesDigest(surface: UISurface, expected: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return true;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(surface)));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("") === expected;
}
