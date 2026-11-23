import { z } from "zod";
import { readUISurface, type UISurface } from "./catalog";

const identity = {
  messageId: z.string().min(1).max(120),
  attempt: z.number().int().nonnegative(),
  round: z.number().int().nonnegative(),
};
const uiEvent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("append"), ...identity,
    from: z.number().int().min(0).max(8), revision: z.number().int().min(1).max(8),
    groups: z.array(z.string().max(14 * 1024)).min(1).max(2) }),
  z.strictObject({ kind: z.literal("reset"), ...identity }),
  z.strictObject({ kind: z.literal("commit"), ...identity,
    revision: z.number().int().min(1).max(8), digest: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
export type UIEvent = z.infer<typeof uiEvent>;

export function readUIEvent(raw: unknown): UIEvent | null {
  const parsed = uiEvent.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function readStoredUI(serialized: string | undefined): UISurface | null {
  if (!serialized || serialized.length > 32 * 1024) return null;
  try {
    return readUISurface(JSON.parse(serialized));
  } catch {
    return null;
  }
}
