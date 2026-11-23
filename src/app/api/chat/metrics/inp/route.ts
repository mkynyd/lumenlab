import { z } from "zod";
import { resolveAppOrigin } from "@/lib/app-origin";
import { auth } from "@/lib/auth";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";
import {
  CHAT_INP_RETENTION_DAYS,
  chatInpKey,
} from "@/lib/chat/intelligent-ui/inp-metrics";

const DAY_MS = 86_400_000;
const MAX_BODY_BYTES = 256;
const reportSchema = z.strictObject({
  id: z.uuidv4(),
  day: z.iso.date(),
  screen: z.enum(["narrow", "wide"]),
  ms: z.number().int().min(0).max(60_000),
});

/**
 * Best-effort browser INP sample sink for pages that rendered an intelligent
 * UI surface. Every invalid, unauthenticated, cross-origin, disabled or
 * rate-limited report is acknowledged with 204 so measurement can never
 * change the conversation or surface an error to the user.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (
      process.env.CHAT_INTELLIGENT_UI_RENDER === "0" ||
      request.headers.get("origin") !== resolveAppOrigin(request.url)
    ) {
      return noContent();
    }

    const sample = reportSchema.safeParse(await readSample(request));
    if (!sample.success) return noContent();
    const { id, day, screen, ms } = sample.data;
    const today = Math.floor(Date.now() / DAY_MS);
    const bucketDay = Date.parse(day) / DAY_MS;
    if (bucketDay > today || bucketDay < today - (CHAT_INP_RETENTION_DAYS - 1)) {
      return noContent();
    }

    const userId = (await auth())?.user?.id;
    if (
      !userId ||
      !(await checkRateLimit(
        `chat-inp:${userId}`,
        RateLimits.CHAT_INP.max,
        RateLimits.CHAT_INP.window
      )).allowed
    ) {
      return noContent();
    }

    const key = chatInpKey(day, screen);
    const expiresAt = Math.floor(Date.parse(day) / 1000) + CHAT_INP_RETENTION_DAYS * 86_400;
    await getRedis()
      .multi()
      .zadd(key, ms, id)
      .expireat(key, expiresAt)
      .exec();
  } catch {
    // INP is an observation channel; a failed sample never affects the UI.
  }
  return noContent();
}

function noContent() {
  return new Response(null, { status: 204 });
}

async function readSample(request: Request): Promise<unknown> {
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return null;
  }
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
  } finally {
    reader.releaseLock();
  }
}
