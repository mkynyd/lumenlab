import { ApiError } from "@/lib/api/client";

/**
 * Learner-facing error copy for learning views. Server messages from the
 * learning API's `{ error: { code, message } }` envelope pass through (they
 * are already localized); anything else — network TypeErrors like "Failed to
 * fetch", bare status fallbacks, unexpected shapes — collapses to a static
 * friendly message so raw browser or internal errors never reach the UI.
 */
export function friendlyLearningError(error: unknown): string {
  if (error instanceof ApiError) {
    const payload: unknown = error.payload;
    if (payload && typeof payload === "object" && "error" in payload) {
      const body = (payload as { error?: unknown }).error;
      if (body && typeof body === "object" && "message" in body) {
        const message = (body as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) {
          return message;
        }
      }
    }
    if (error.message && !/^请求失败 \(\d+\)$/.test(error.message)) {
      return error.message;
    }
  }
  return "网络异常或服务暂时不可用，请稍后重试。";
}
