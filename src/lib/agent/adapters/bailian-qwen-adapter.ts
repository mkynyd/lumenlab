import { randomUUID } from "crypto";
import path from "path";
import type { DeepSeekContentBlock, DeepSeekMessage } from "@/lib/deepseek";
import { isTextAttachment } from "@/lib/chat/router";
import {
  createSignedDownloadUrl,
  deleteStoredObject,
  uploadObjectBuffer,
} from "@/lib/storage/object-storage";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import type {
  AdapterStreamParams,
  AdapterStreamResult,
  AdapterUsage,
  ProviderAdapter,
  ProviderContinuationInput,
  ProviderRound,
  ProviderRoundInput,
  ProviderToolProtocol,
} from "@/lib/agent/provider-adapter";
import { createProviderRound } from "@/lib/agent/provider-adapter";
import type { ToolMetadata } from "@/lib/agent/types";

const DASHSCOPE_GENERATION_PATH = "/services/aigc/multimodal-generation/generation";

type DashScopeContentPart =
  | { text: string }
  | { image: string }
  | { video: string };

interface DashScopeToolCall {
  /** DashScope emits these fields incrementally in SSE tool-call deltas. */
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface DashScopeMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: DashScopeContentPart[];
  reasoning_content?: string;
  tool_calls?: DashScopeToolCall[];
  tool_call_id?: string;
}

export interface DashScopeStreamRequest {
  endpoint: string;
  apiKey: string;
  body: {
    model: "qwen3.7-plus";
    input: { messages: DashScopeMessage[] };
    parameters: {
      enable_thinking: boolean;
      preserve_thinking: boolean;
      incremental_output: true;
      result_format: "message";
      tools?: Array<{
        type: "function";
        function: {
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        };
      }>;
    };
  };
  signal?: AbortSignal;
}

export interface DashScopeTransport {
  stream(request: DashScopeStreamRequest): AsyncIterable<unknown>;
}

interface ResolvedMediaPart {
  part: DashScopeContentPart;
  cleanup?: () => Promise<void>;
}

export type DashScopeMediaResolver = (
  attachment: NonNullable<AdapterStreamParams["attachments"]>[number]
) => Promise<ResolvedMediaPart>;

class DefaultDashScopeTransport implements DashScopeTransport {
  async *stream(request: DashScopeStreamRequest): AsyncIterable<unknown> {
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-SSE": "enable",
      },
      body: JSON.stringify(request.body),
      signal: request.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new DashScopeTransportError(
        response.status,
        detail || `DashScope HTTP ${response.status}`
      );
    }
    if (!response.body) {
      throw new DashScopeTransportError(502, "DashScope 未返回流式响应");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseDashScopeSseLine(line);
          if (event !== undefined) yield event;
        }
      }
      buffer += decoder.decode();
      const event = parseDashScopeSseLine(buffer);
      if (event !== undefined) yield event;
    } finally {
      reader.releaseLock();
    }
  }
}

class DashScopeTransportError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "DashScopeTransportError";
  }
}

export class BailianQwenError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "BailianQwenError";
  }
}

/**
 * DashScope-native Qwen adapter. Pi is deliberately not used here: Pi owns the
 * isolated DeepSeek/MiniMax protocol POC, while DashScope's native multimodal
 * and Function Calling schema is the source of truth for Qwen.
 */
export class BailianQwenAdapter implements ProviderAdapter {
  readonly provider = "bailian" as const;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    private readonly transport: DashScopeTransport = new DefaultDashScopeTransport(),
    private readonly resolveMedia: DashScopeMediaResolver = resolveDashScopeMedia
  ) {
    this.endpoint = `${baseUrl.replace(/\/$/, "")}${DASHSCOPE_GENERATION_PATH}`;
  }

  private readonly endpoint: string;

  async stream(params: AdapterStreamParams): Promise<AdapterStreamResult> {
    if (params.model !== "qwen3.7-plus") {
      throw new BailianQwenError(400, `DashScope POC 不支持模型：${params.model}`);
    }

    const abortController = new AbortController();
    const relayAbort = () => abortController.abort(params.signal?.reason);
    if (params.signal?.aborted) relayAbort();
    params.signal?.addEventListener("abort", relayAbort, { once: true });

    let cleanupMedia: Array<() => Promise<void>> = [];
    let source: AsyncIterable<unknown>;
    try {
      const serialized = await toDashScopeMessages(
        params.messages,
        params.attachments,
        this.resolveMedia
      );
      cleanupMedia = serialized.cleanup;
      source = this.transport.stream({
        endpoint: this.endpoint,
        apiKey: this.apiKey,
        body: {
          model: "qwen3.7-plus",
          input: { messages: serialized.messages },
          parameters: {
            enable_thinking: params.thinkingEnabled,
            preserve_thinking: params.thinkingEnabled,
            incremental_output: true,
            result_format: "message",
            ...(params.tools?.length
              ? {
                  tools: params.tools.map((tool) => ({
                    type: "function" as const,
                    function: {
                      name: tool.name,
                      description: tool.description ?? "",
                      parameters: tool.input_schema ?? {
                        type: "object",
                        properties: {},
                      },
                    },
                  })),
                }
              : {}),
          },
        },
        signal: abortController.signal,
      });
    } catch (error) {
      params.signal?.removeEventListener("abort", relayAbort);
      await cleanupAll(cleanupMedia);
      throw toBailianQwenError(error, abortController.signal.aborted);
    }

    let usage: AdapterUsage | null = null;
    let rawContent = "";
    let rawReasoning = "";
    const toolCalls = new Map<string, { id: string; name: string; input: Record<string, unknown> }>();
    const streamedToolCalls = new Map<string, {
      id?: string;
      name?: string;
      arguments: string;
    }>();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of source) {
            const message = outputMessage(event);
            if (!message) continue;
            if (message.reasoning_content) {
              rawReasoning += message.reasoning_content;
              controller.enqueue(encodeSse(encoder, {
                choices: [{ delta: { reasoning_content: message.reasoning_content } }],
              }));
            }
            const text = textFromContent(message.content);
            if (text) {
              rawContent += text;
              controller.enqueue(encodeSse(encoder, {
                choices: [{ delta: { content: text } }],
              }));
            }
            for (const call of message.tool_calls ?? []) {
              mergeStreamedToolCall(streamedToolCalls, toolCalls, call);
            }
            const nextUsage = usageFromEvent(event);
            if (nextUsage) usage = nextUsage;
          }
          if (usage) controller.enqueue(encodeSse(encoder, { usage }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          controller.error(toBailianQwenError(error, abortController.signal.aborted));
        } finally {
          params.signal?.removeEventListener("abort", relayAbort);
          await cleanupAll(cleanupMedia);
        }
      },
      async cancel(reason) {
        abortController.abort(reason);
        params.signal?.removeEventListener("abort", relayAbort);
        await cleanupAll(cleanupMedia);
      },
    });

    return {
      stream,
      getUsage: () => usage,
      getToolCalls: () => [...toolCalls.values()],
      getRawContent: () => rawContent,
      getRawReasoning: () => rawReasoning,
    };
  }

  toolProtocol(activeTools: ToolMetadata[]): ProviderToolProtocol {
    return activeTools.length > 0 ? "native" : "none";
  }

  async startRound(params: ProviderRoundInput): Promise<ProviderRound> {
    const result = await this.stream({
      ...params,
      tools: params.activeTools.map((tool) => ({
        name: tool.toolId,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    });
    return createProviderRound(result, (name) => name, params.messages);
  }

  async continueRound(params: ProviderContinuationInput): Promise<ProviderRound> {
    const assistantContent: DeepSeekContentBlock[] = [];
    const text = sanitizeModelText(params.rawContent);
    if (text) assistantContent.push({ type: "text", text });
    for (const call of params.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      });
    }
    const messages: DeepSeekMessage[] = [
      ...params.messages,
      { role: "assistant", content: assistantContent },
      {
        role: "user",
        content: params.toolResults.map((result) => ({
          type: "tool_result" as const,
          tool_use_id: result.toolUseId,
          content: result.content,
        })),
      },
    ];
    return this.startRound({
      ...params,
      messages: params.stopInstruction
        ? [...messages, { role: "user", content: params.stopInstruction } as DeepSeekMessage]
        : messages,
      activeTools: params.stopInstruction ? [] : params.activeTools,
      attachments: [],
    });
  }
}

async function toDashScopeMessages(
  messages: DeepSeekMessage[],
  attachments: AdapterStreamParams["attachments"],
  resolveMedia: DashScopeMediaResolver
) {
  const serialized: DashScopeMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      serialized.push({ role: "system", content: textParts(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      const { text, toolCalls } = assistantParts(message.content);
      serialized.push({
        role: "assistant",
        ...(text.length ? { content: text } : {}),
        ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    const text: DashScopeContentPart[] = [];
    const toolResults: Array<{ id: string; content: string }> = [];
    if (typeof message.content === "string") {
      if (message.content) text.push({ text: message.content });
    } else {
      for (const block of message.content) {
        if (block.type === "text") text.push({ text: block.text });
        if (block.type === "tool_result") {
          toolResults.push({ id: block.tool_use_id, content: block.content });
        }
      }
    }
    if (text.length > 0 || toolResults.length === 0) {
      serialized.push({ role: "user", content: text });
    }
    for (const result of toolResults) {
      serialized.push({
        role: "tool",
        tool_call_id: result.id,
        content: [{ text: result.content }],
      });
    }
  }

  const cleanup: Array<() => Promise<void>> = [];
  try {
    const media = await Promise.all(
      (attachments ?? [])
        .filter((attachment) => !isTextAttachment(attachment))
        .map((attachment) => resolveMedia(attachment))
    );
    for (const item of media) {
      lastUserMessage(serialized).content?.push(item.part);
      if (item.cleanup) cleanup.push(item.cleanup);
    }
    return { messages: serialized, cleanup };
  } catch (error) {
    await cleanupAll(cleanup);
    throw error;
  }
}

function lastUserMessage(messages: DashScopeMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  const message: DashScopeMessage = { role: "user", content: [] };
  messages.push(message);
  return message;
}

function textParts(content: DeepSeekMessage["content"]): DashScopeContentPart[] {
  if (typeof content === "string") return content ? [{ text: content }] : [];
  return content.flatMap((block) => block.type === "text" ? [{ text: block.text }] : []);
}

function assistantParts(content: DeepSeekMessage["content"]) {
  const text = textParts(content);
  const blocks = typeof content === "string" ? [] : content;
  const toolCalls: DashScopeToolCall[] = blocks.flatMap((block) =>
    block.type === "tool_use"
      ? [{
          id: block.id,
          type: "function" as const,
          function: { name: block.name, arguments: JSON.stringify(block.input) },
        }]
      : []
  );
  return { text, toolCalls };
}

async function resolveDashScopeMedia(
  attachment: NonNullable<AdapterStreamParams["attachments"]>[number]
): Promise<ResolvedMediaPart> {
  if (attachment.mimeType.startsWith("image/")) {
    return {
      part: {
        image: `data:${attachment.mimeType};base64,${attachment.data.toString("base64")}`,
      },
    };
  }
  if (!attachment.mimeType.startsWith("video/")) {
    throw new BailianQwenError(
      400,
      `Qwen 仅支持图片或视频理解，当前附件类型为：${attachment.mimeType || attachment.name}`
    );
  }

  const key = `transient/qwen/${randomUUID()}${path.extname(attachment.name).toLowerCase() || ".mp4"}`;
  const stored = await uploadObjectBuffer({
    key,
    mimeType: attachment.mimeType,
    buffer: attachment.data,
  });
  if (stored.provider !== "qiniu") {
    await deleteStoredObject(stored);
    throw new BailianQwenError(
      503,
      "Qwen 视频理解需要已配置七牛对象存储，以生成短期受限访问链接"
    );
  }
  return {
    part: {
      video: createSignedDownloadUrl({
        provider: stored.provider,
        key: stored.key,
        expiresInSeconds: 600,
      }),
    },
    cleanup: () => deleteStoredObject(stored),
  };
}

function outputMessage(event: unknown): DashScopeMessage | null {
  if (!event || typeof event !== "object") return null;
  const output = (event as { output?: { choices?: Array<{ message?: DashScopeMessage }> } }).output;
  return output?.choices?.[0]?.message ?? null;
}

function usageFromEvent(event: unknown): AdapterUsage | null {
  if (!event || typeof event !== "object") return null;
  const usage = (event as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  }).usage;
  if (!usage || typeof usage.input_tokens !== "number") return null;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? usage.input_tokens + (usage.output_tokens ?? 0),
    prompt_cache_hit_tokens: cached,
    prompt_cache_miss_tokens: Math.max(0, usage.input_tokens - cached),
  };
}

function textFromContent(content: DashScopeContentPart[] | string | undefined) {
  if (typeof content === "string") return content;
  return content?.flatMap((part) => "text" in part ? [part.text] : []).join("") ?? "";
}

function mergeStreamedToolCall(
  partials: Map<string, { id?: string; name?: string; arguments: string }>,
  completed: Map<string, { id: string; name: string; input: Record<string, unknown> }>,
  call: DashScopeToolCall
) {
  const key = typeof call.index === "number"
    ? `index:${call.index}`
    : call.id
      ? `id:${call.id}`
      : undefined;
  if (!key) return;

  const previous = partials.get(key) ?? { arguments: "" };
  const nextArguments = mergeToolArguments(
    previous.arguments,
    call.function?.arguments
  );
  const next = {
    id: nonEmptyString(call.id) ?? previous.id,
    name: nonEmptyString(call.function?.name) ?? previous.name,
    arguments: nextArguments,
  };
  partials.set(key, next);
  if (!next.id || !next.name) return;
  completed.set(next.id, {
    id: next.id,
    name: next.name,
    input: parseToolArguments(next.arguments),
  });
}

function mergeToolArguments(previous: string, incoming: string | undefined) {
  if (!incoming) return previous;
  // Some DashScope SSE frames carry the entire argument buffer; others carry
  // only the new suffix. Handle both without duplicating JSON fragments.
  if (incoming.startsWith(previous)) return incoming;
  return `${previous}${incoming}`;
}

function nonEmptyString(value: string | undefined) {
  return value && value.trim() ? value : undefined;
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseDashScopeSseLine(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

function toBailianQwenError(error: unknown, aborted: boolean) {
  if (aborted || (error instanceof DOMException && error.name === "AbortError")) {
    return new DOMException("The operation was aborted", "AbortError");
  }
  if (error instanceof BailianQwenError) return error;
  const status = error instanceof DashScopeTransportError
    ? error.status
    : statusFromError(error);
  const detail = error instanceof Error ? error.message : String(error);
  return new BailianQwenError(status, friendlyBailianMessage(status, detail));
}

function statusFromError(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return 0;
}

function friendlyBailianMessage(status: number, fallback: string) {
  const messages: Record<number, string> = {
    400: "Qwen 拒绝了当前消息（格式、附件或上下文不符合要求）",
    401: "百炼 API Key 无效，请在设置中更新",
    403: "当前百炼凭据无权访问 Qwen3.7-Plus",
    413: "附件或请求体超过 Qwen 限制",
    429: "Qwen 请求频率过高，请稍后重试",
    500: "Qwen 服务异常，请稍后重试",
    502: "Qwen 服务暂时不可用，请稍后重试",
    503: "Qwen 服务繁忙，请稍后重试",
  };
  return messages[status] ?? fallback;
}

async function cleanupAll(cleanup: Array<() => Promise<void>>) {
  await Promise.allSettled(cleanup.map((entry) => entry()));
}

function encodeSse(encoder: TextEncoder, payload: Record<string, unknown>) {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}
