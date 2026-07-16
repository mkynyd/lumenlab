import {
  createModels,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type TSchema,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn";
import type { DeepSeekContentBlock, DeepSeekMessage } from "@/lib/deepseek";
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
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";

type PiAiProviderId = "deepseek" | "minimax-cn";

export interface PiAiStreamRequest {
  providerId: PiAiProviderId;
  modelId: string;
  apiKey: string;
  context: Context;
  reasoning?: ThinkingLevel;
  signal?: AbortSignal;
  onResponse?: (status: number) => void;
}

export interface PiAiTransport {
  stream(request: PiAiStreamRequest): AsyncIterable<AssistantMessageEvent>;
}

class DefaultPiAiTransport implements PiAiTransport {
  stream(request: PiAiStreamRequest): AsyncIterable<AssistantMessageEvent> {
    const models = createModels();
    models.setProvider(
      request.providerId === "deepseek"
        ? deepseekProvider()
        : minimaxCnProvider()
    );
    const model = models.getModel(request.providerId, request.modelId);
    if (!model) {
      throw new Error(
        `pi-ai model not found: ${request.providerId}/${request.modelId}`
      );
    }
    return models.streamSimple(model, request.context, {
      apiKey: request.apiKey,
      reasoning: request.reasoning,
      signal: request.signal,
      maxRetries: 0,
      onResponse: (response) => request.onResponse?.(response.status),
    });
  }
}

export class PiAiProviderError extends Error {
  constructor(
    public readonly provider: "deepseek" | "minimax",
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "PiAiProviderError";
  }
}

export class PiAiAdapter implements ProviderAdapter {
  readonly provider: "deepseek" | "minimax";

  constructor(
    provider: "deepseek" | "minimax",
    private readonly apiKey: string,
    private readonly transport: PiAiTransport = new DefaultPiAiTransport()
  ) {
    this.provider = provider;
  }

  async stream(params: AdapterStreamParams): Promise<AdapterStreamResult> {
    assertSupportedAttachments(this.provider, params.attachments);
    const abortController = new AbortController();
    const relayAbort = () => abortController.abort(params.signal?.reason);
    if (params.signal?.aborted) relayAbort();
    params.signal?.addEventListener("abort", relayAbort, { once: true });

    let usage: AdapterUsage | null = null;
    let rawContent = "";
    let rawReasoning = "";
    let responseStatus: number | undefined;
    const provider = this.provider;
    const toolCalls = new Map<
      string,
      { id: string; name: string; input: Record<string, unknown> }
    >();
    const encoder = new TextEncoder();
    let source: AsyncIterable<AssistantMessageEvent>;
    try {
      source = this.transport.stream({
        providerId: this.piProviderId(),
        modelId: this.piModelId(params.model),
        apiKey: this.apiKey,
        context: toPiContext(
          params.messages,
          params.attachments,
          params.tools,
          (name) => this.toNativeToolName(name)
        ),
        reasoning: params.thinkingEnabled ? params.reasoningEffort : undefined,
        signal: abortController.signal,
        onResponse: (status) => {
          responseStatus = status;
        },
      });
    } catch (error) {
      params.signal?.removeEventListener("abort", relayAbort);
      throw toPiProviderError(this.provider, error, responseStatus);
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of source) {
            if (event.type === "thinking_delta") {
              rawReasoning += event.delta;
              controller.enqueue(
                encodeSse(encoder, {
                  choices: [{ delta: { reasoning_content: event.delta } }],
                })
              );
            } else if (event.type === "text_delta") {
              rawContent += event.delta;
              controller.enqueue(
                encodeSse(encoder, {
                  choices: [{ delta: { content: event.delta } }],
                })
              );
            } else if (event.type === "done") {
              usage = toAdapterUsage(event.message);
              collectToolCalls(event.message, toolCalls);
              controller.enqueue(encodeSse(encoder, { usage }));
            } else if (event.type === "toolcall_end") {
              toolCalls.set(event.toolCall.id, {
                id: event.toolCall.id,
                name: event.toolCall.name,
                input: event.toolCall.arguments,
              });
            } else if (event.type === "error") {
              if (event.reason === "aborted" || abortController.signal.aborted) {
                throw abortError();
              }
              throw toPiProviderError(
                provider,
                event.error.errorMessage || "pi-ai provider error",
                responseStatus
              );
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          params.signal?.removeEventListener("abort", relayAbort);
        }
      },
      cancel(reason) {
        abortController.abort(reason);
        params.signal?.removeEventListener("abort", relayAbort);
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

  toolProtocol(activeTools: ProviderRoundInput["activeTools"]): ProviderToolProtocol {
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
    return createProviderRound(
      result,
      (name) => this.fromNativeToolName(name),
      params.messages
    );
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
        ? [
            ...messages,
            { role: "user", content: params.stopInstruction } as DeepSeekMessage,
          ]
        : messages,
      activeTools: params.stopInstruction ? [] : params.activeTools,
      attachments: [],
    });
  }

  private piProviderId(): PiAiProviderId {
    return this.provider === "deepseek" ? "deepseek" : "minimax-cn";
  }

  private piModelId(model: string) {
    return this.provider === "minimax" ? "MiniMax-M3" : model;
  }

  /** Pi providers reject dotted function names; Runtime tool IDs keep dots. */
  private toNativeToolName(toolId: string) {
    return `lumen_${Buffer.from(toolId, "utf8").toString("hex")}`;
  }

  private fromNativeToolName(name: string) {
    if (!name.startsWith("lumen_")) return name;
    const encoded = name.slice("lumen_".length);
    if (!encoded || encoded.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(encoded)) {
      return name;
    }
    const decoded = Buffer.from(encoded, "hex").toString("utf8");
    return decoded || name;
  }
}

function toPiContext(
  messages: DeepSeekMessage[],
  attachments: AdapterStreamParams["attachments"],
  tools: AdapterStreamParams["tools"],
  toNativeToolName: (name: string) => string
): Context {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) =>
      typeof message.content === "string" ? message.content : ""
    )
    .filter(Boolean)
    .join("\n\n");
  const converted: Context["messages"] = [];
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      if (typeof message.content === "string") {
        converted.push({ role: "user", content: message.content, timestamp: 0 });
        continue;
      }
      const textBlocks = message.content.filter(
        (block): block is Extract<(typeof message.content)[number], { type: "text" }> =>
          block.type === "text"
      );
      if (textBlocks.length > 0) {
        converted.push({
          role: "user",
          content:
            textBlocks.length === 1
              ? textBlocks[0].text
              : textBlocks.map((block) => ({ type: "text" as const, text: block.text })),
          timestamp: 0,
        });
      }
      for (const block of message.content) {
        if (block.type !== "tool_result") continue;
        converted.push({
          role: "toolResult",
          toolCallId: block.tool_use_id,
          toolName: toolNames.get(block.tool_use_id) ?? "tool",
          content: [{ type: "text", text: block.content }],
          isError: false,
          timestamp: 0,
        });
      }
      continue;
    }
    if (message.role === "assistant") {
      const content = [] as AssistantMessage["content"];
      if (message.reasoning_content) {
        content.push({ type: "thinking", thinking: message.reasoning_content });
      }
      if (typeof message.content === "string") {
        if (message.content) content.push({ type: "text", text: message.content });
      } else {
        for (const block of message.content) {
          if (block.type === "text") content.push(block);
          if (block.type === "tool_use") {
            toolNames.set(block.id, toNativeToolName(block.name));
            content.push({
              type: "toolCall",
              id: block.id,
              name: toNativeToolName(block.name),
              arguments: block.input,
            });
          }
        }
      }
      if (content.length > 0) {
        converted.push({
          role: "assistant",
          content,
          api: "openai-completions",
          provider: "lumenlab-poc",
          model: "lumenlab-poc",
          usage: emptyUsage(),
          stopReason: "stop",
          timestamp: 0,
        });
      }
    }
  }

  appendImageAttachments(converted, attachments);

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages: converted,
    ...(tools?.length
      ? {
          tools: tools.map((tool) => ({
            name: toNativeToolName(tool.name),
            description: tool.description ?? "",
            parameters: (tool.input_schema ?? {
              type: "object",
              properties: {},
            }) as TSchema,
          })),
        }
      : {}),
  };
}

function appendImageAttachments(
  messages: Context["messages"],
  attachments: AdapterStreamParams["attachments"]
) {
  if (!attachments?.length) return;
  const images = attachments.map((attachment) => ({
    type: "image" as const,
    data: attachment.data.toString("base64"),
    mimeType: attachment.mimeType,
  }));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    messages[index] = {
      ...message,
      content: [
        ...(typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content),
        ...images,
      ],
    };
    return;
  }
}

function assertSupportedAttachments(
  provider: "deepseek" | "minimax",
  attachments: AdapterStreamParams["attachments"]
) {
  if (!attachments?.length) return;
  if (provider !== "minimax") {
    throw new PiAiProviderError(
      provider,
      400,
      "pi-ai POC 仅允许 MiniMax M3 接收图片附件"
    );
  }
  const unsupported = attachments.find(
    (attachment) => !attachment.mimeType.startsWith("image/")
  );
  if (unsupported) {
    throw new PiAiProviderError(
      provider,
      400,
      `pi-ai POC 暂不支持附件类型：${unsupported.mimeType || unsupported.name}`
    );
  }
}

function collectToolCalls(
  message: AssistantMessage,
  calls: Map<string, { id: string; name: string; input: Record<string, unknown> }>
) {
  for (const block of message.content) {
    if (block.type !== "toolCall") continue;
    calls.set(block.id, {
      id: block.id,
      name: block.name,
      input: block.arguments,
    });
  }
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function abortError() {
  return new DOMException("The operation was aborted", "AbortError");
}

function toPiProviderError(
  provider: "deepseek" | "minimax",
  error: unknown,
  responseStatus?: number
) {
  if (error instanceof PiAiProviderError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  const status = responseStatus ?? statusFromMessage(detail);
  return new PiAiProviderError(provider, status, friendlyProviderMessage(provider, status, detail));
}

function statusFromMessage(message: string) {
  const match = message.match(/(?:HTTP|status|error)\s*[:=]?\s*(4\d{2}|5\d{2})\b/i);
  return match ? Number(match[1]) : 0;
}

function friendlyProviderMessage(
  provider: "deepseek" | "minimax",
  status: number,
  fallback: string
) {
  const messages =
    provider === "deepseek"
      ? {
          400: "DeepSeek 拒绝了当前消息（格式或长度不符合要求）。请尝试关闭深度后再发送，或换用 MiniMax 模型。",
          401: "DeepSeek API Key 无效，请在设置中更新",
          402: "DeepSeek 账户余额不足，请前往平台充值",
          422: "参数错误，请检查模型设置",
          429: "DeepSeek 请求频率过高，请稍后重试",
          500: "DeepSeek 服务器异常，请稍后重试",
          503: "DeepSeek 服务繁忙，请稍后重试",
          529: "DeepSeek 服务过载，请稍后重试",
        }
      : {
          400: "MiniMax 请求格式无效",
          401: "MiniMax API Key 无效，请在设置中更新",
          413: "附件或请求体超过 MiniMax 限制",
          429: "MiniMax 请求频率过高，请稍后重试",
          500: "MiniMax 服务异常，请稍后重试",
          529: "MiniMax 服务过载，请稍后重试",
        };
  return messages[status as keyof typeof messages] ?? fallback;
}

function toAdapterUsage(message: AssistantMessage): AdapterUsage {
  const promptTokens =
    message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: message.usage.output,
    total_tokens: message.usage.totalTokens,
    prompt_cache_hit_tokens: message.usage.cacheRead,
    prompt_cache_miss_tokens: message.usage.input + message.usage.cacheWrite,
  };
}

function encodeSse(
  encoder: TextEncoder,
  payload: Record<string, unknown>
): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}
