import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PrismaAgentExecutionStore } from "@/lib/agent/executions/prisma-agent-execution-store";

const encoder = new TextEncoder();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response(JSON.stringify({ error: "请先登录" }), { status: 401, headers: { "Content-Type": "application/json" } });
  const runId = (await context.params).id;
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId: session.user.id }, select: { agentExecutionId: true } });
  if (!run) return new Response(JSON.stringify({ error: "研究运行不存在或无权访问" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (!run.agentExecutionId) return new Response(JSON.stringify({ error: "研究运行尚未进入 durable execution" }), { status: 409, headers: { "Content-Type": "application/json" } });

  const store = new PrismaAgentExecutionStore();
  const execution = await store.getOwnedExecution({ executionId: run.agentExecutionId, userId: session.user.id });
  if (!execution) return new Response(JSON.stringify({ error: "执行记录不存在" }), { status: 404, headers: { "Content-Type": "application/json" } });
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  const signal = request.signal;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let cursor = Number.isFinite(after) && after >= 0 ? after : 0;
        let idleRounds = 0;
        try {
          while (!signal.aborted && idleRounds < 1_200) {
            const events = await store.listEventsAfter({ executionId: execution.id, userId: session.user.id, afterSequence: cursor, limit: 100 });
            if (events === null) break;
            if (events.length === 0) {
              const currentRun = await prisma.researchRun.findFirst({ where: { id: runId, userId: session.user.id }, select: { status: true } });
              if (!currentRun || ["completed", "failed", "cancelled"].includes(currentRun.status)) break;
              idleRounds += 1;
              await new Promise((resolve) => setTimeout(resolve, 250));
              continue;
            }
            idleRounds = 0;
            for (const event of events) {
              cursor = event.sequence;
              if (event.type !== "research_event") continue;
              controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: research\ndata: ${JSON.stringify(event.payload ?? {})}\n\n`));
            }
            const currentRun = await prisma.researchRun.findFirst({ where: { id: runId, userId: session.user.id }, select: { status: true } });
            if (!currentRun || ["completed", "failed", "cancelled"].includes(currentRun.status)) break;
          }
          if (!signal.aborted) controller.close();
        } catch (error) {
          if (!signal.aborted) controller.error(error);
        }
      })();
    },
    cancel() {
      // The request signal terminates the polling loop; no durable state is changed by disconnecting.
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
