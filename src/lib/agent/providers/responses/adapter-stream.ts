import type { AdapterStreamParams, AdapterStreamResult } from "@/lib/agent/provider-adapter";
import type { DeepSeekMessage } from "@/lib/deepseek";
import { getModelCatalogEntry } from "@/lib/chat/model-catalog";
import { isTextAttachment } from "@/lib/chat/router";
import { normalizeResponsesStream, ResponsesStreamAccumulator, type ResponsesTerminalState } from "./serialize";
import { streamResponses, type ResponsesTransportRequest } from "./transport";

export class ResponsesModelError extends Error {
  readonly status = 400;
}

export class ResponsesConfigurationError extends Error {
  readonly status = 503;
}

export class ResponsesTerminalError extends Error {
  constructor(public readonly terminal: ResponsesTerminalState) {
    const labels = { completed: "已完成", incomplete: "回答未完成", refused: "模型拒绝了请求", failed: "模型生成失败" };
    super(`${labels[terminal.status]}${terminal.reason ? `（${terminal.reason}）` : ""}${terminal.error?.message ? `：${terminal.error.message}` : ""}`);
    this.name = "ResponsesTerminalError";
  }
}

export function responsesModel(model: string, provider: "deepseek" | "minimax" | "bailian") {
  const entry = getModelCatalogEntry(model);
  if (!entry?.enabled || entry.provider !== provider) {
    throw new ResponsesModelError(`当前 ${provider} Responses 路径不支持模型：${model}`);
  }
  return entry.wireId;
}

/** Keep original media on its user turn, so stateless tool rounds can replay it.
 * These buffers never enter durable checkpoints: attachment requests remain gated.
 * Plain historical reasoning has no provider provenance and is not replayed.
 */
export function prepareResponsesMessages(params: AdapterStreamParams): DeepSeekMessage[] {
  const messages = params.messages.map((message) => {
    const next = { ...message };
    delete next.reasoning_content;
    return next;
  });
  const attachments = params.attachments?.filter((attachment) => !isTextAttachment(attachment));
  if (attachments?.length && !messages.some((message) => message.attachments?.length)) {
    const target = messages.findLast((message) => message.role === "user");
    if (target) target.attachments = attachments;
    else messages.push({ role: "user", content: "", attachments });
  }
  return messages;
}

/** Thin compatibility bridge: only internal model-delta SSE leaves this file. */
export async function streamResponsesAdapter(
  request: ResponsesTransportRequest
): Promise<AdapterStreamResult> {
  const abort = new AbortController();
  const relay = () => abort.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", relay, { once: true });
  if (request.signal?.aborted) relay();
  let cleaned = false;
  const dispose = async () => {
    if (cleaned) return;
    cleaned = true;
    request.signal?.removeEventListener("abort", relay);
  };
  const accumulator = new ResponsesStreamAccumulator();
  let source;
  try {
    source = await streamResponses({ ...request, signal: abort.signal });
  } catch (error) {
    await dispose();
    throw error;
  }
  const iterator = normalizeResponsesStream(source, accumulator);
  const encoder = new TextEncoder();
  let cancelled = false;
  let successful = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!cancelled) {
          const next = await iterator.next();
          if (cancelled) return;
          if (next.done) {
            await dispose();
            successful = true;
            controller.close();
            return;
          }
          const event = next.value;
          if (event.type === "terminal") {
            if (event.terminal.status !== "completed") throw new ResponsesTerminalError(event.terminal);
            continue;
          }
          const payload = event.type === "usage" ? { usage: event.usage } : {
            choices: [{ delta: event.type === "text_delta" ? { content: event.text } : { reasoning_content: event.text } }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          return;
        }
      } catch (error) {
        abort.abort(error);
        await iterator.return(undefined).catch(() => {});
        await dispose();
        if (!cancelled) controller.error(error);
      }
    },
    async cancel(reason) {
      cancelled = true;
      abort.abort(reason);
      await iterator.return(undefined).catch(() => {});
      await dispose();
    },
  });
  return {
    stream,
    getUsage: () => accumulator.usage,
    getToolCalls: () => successful
      ? accumulator.toolCalls.map((call) => ({ id: call.callId, name: call.name, input: call.input })) : [],
    getRawContent: () => accumulator.rawText,
    getRawReasoning: () => accumulator.rawReasoning,
  };
}
