import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export interface ErrorEventInput {
  source: "client" | "server";
  message: string;
  stack?: string | null;
  route?: string | null;
  userId?: string | null;
  userAgent?: string | null;
}

/** 错误指纹：同 source + route + message + stack 首行视为同一错误。 */
export function computeErrorDigest(input: {
  source: string;
  message: string;
  stack?: string | null;
  route?: string | null;
}): string {
  const firstStackLine = input.stack?.split("\n").find((line) => line.trim()) ?? "";
  return createHash("sha256")
    .update([input.source, input.route ?? "", input.message, firstStackLine].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

/** 按 digest 聚合落库；重复错误只累加 count、刷新 lastSeenAt。 */
export async function recordErrorEvent(input: ErrorEventInput): Promise<void> {
  const message = input.message.slice(0, 500);
  const stack = input.stack ? input.stack.slice(0, 4000) : null;
  const route = input.route ?? null;
  const digest = computeErrorDigest({ source: input.source, message, stack, route });
  const now = new Date();

  await prisma.errorEvent.upsert({
    where: { digest },
    update: { count: { increment: 1 }, lastSeenAt: now },
    create: {
      digest,
      source: input.source,
      message,
      stack,
      route,
      userId: input.userId ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
}

/** 服务端错误的安全记录入口：任何失败只打日志，绝不向外抛。 */
export async function recordServerError(error: unknown, route?: string | null): Promise<void> {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    await recordErrorEvent({
      source: "server",
      message: err.message || "Unknown server error",
      stack: err.stack,
      route: route ?? null,
    });
  } catch (writeError) {
    console.error("记录服务端错误失败", writeError);
  }
}
