import type { Instrumentation } from "next";

// Next.js 服务端错误统一入口：路由 / RSC / Server Action 抛出的未捕获错误都会经过这里。
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordServerError } = await import("@/lib/feedback/events");
    await recordServerError(err, context.routePath ?? request.path);
  }
};

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeWorkers } = await import("./instrumentation-node");
    await registerNodeWorkers();
  }
}
