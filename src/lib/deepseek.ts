import Anthropic from "@anthropic-ai/sdk";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

export interface DeepSeekMessage {
  role: string;
  content: string;
  reasoning_content?: string;
}

export interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  thinking?: { type: "enabled" | "disabled" };
  reasoning_effort?: "high" | "max";
  max_tokens?: number;
  tools?: Array<{ type: string; [key: string]: unknown }>;
}

export interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface StreamResult {
  stream: ReadableStream<Uint8Array>;
  getUsage: () => DeepSeekUsage | null;
  getToolCalls: () => ToolUseBlock[];
}

export const DEEPSEEK_ERROR_MAP: Record<number, string> = {
  400: "DeepSeek 拒绝了当前消息（格式或长度不符合要求）。请尝试关闭深度推理后再发送，或换用 MiniMax 模型。",
  401: "DeepSeek API Key 无效，请在设置中更新",
  402: "DeepSeek 账户余额不足，请前往平台充值",
  422: "参数错误，请检查模型设置",
  429: "DeepSeek 请求频率过高，请稍后重试",
  500: "DeepSeek 服务器异常，请稍后重试",
  503: "DeepSeek 服务繁忙，请稍后重试",
  529: "DeepSeek 服务过载，请稍后重试",
};

export class DeepSeekError extends Error {
  constructor(public status: number, message?: string) {
    super(message || DEEPSEEK_ERROR_MAP[status] || `DeepSeek API 错误 (${status})`);
    this.name = "DeepSeekError";
  }
}

export function mapDeepSeekModel(model: string): string {
  return model === "deepseek-v4-pro"
    ? "claude-opus-4-8"
    : "claude-sonnet-4-6";
}

function createClient(apiKey: string) {
  return new Anthropic({
    baseURL: DEEPSEEK_BASE_URL,
    apiKey,
    timeout: 120_000,
    maxRetries: 0,
  });
}

function splitMessages(messages: DeepSeekMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const history = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

  return { system, history };
}

function toDeepSeekError(error: unknown): DeepSeekError {
  if (error instanceof Anthropic.APIError) {
    // 把上游真实错误信息保留下来(通常是 message 字段),这样前端能拿到可操作的提示,
    // 而不是被 DEEPSEEK_ERROR_MAP 的通用文案覆盖。
    const upstreamMessage =
      (typeof (error as { message?: unknown }).message === "string" &&
        (error as { message: string }).message) ||
      "";
    const fallback = DEEPSEEK_ERROR_MAP[error.status] || `DeepSeek API 错误 (${error.status})`;
    const combined =
      upstreamMessage && !fallback.includes(upstreamMessage)
        ? `${fallback}（${upstreamMessage}）`
        : fallback;
    return new DeepSeekError(error.status, combined);
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new DeepSeekError(0, "请求超时，请重试");
  }
  return new DeepSeekError(0, "无法连接 DeepSeek API，请检查网络");
}

export async function createTextMessage(
  apiKey: string,
  options: {
    model?: string;
    system: string;
    prompt: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  try {
    const response = await createClient(apiKey).messages.create({
      model: mapDeepSeekModel(options.model || "deepseek-v4-flash"),
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.3,
      system: options.system,
      messages: [{ role: "user", content: options.prompt }],
    });

    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  } catch (error) {
    throw toDeepSeekError(error);
  }
}

export async function streamChat(
  apiKey: string,
  params: DeepSeekRequest
): Promise<StreamResult> {
  const { system, history } = splitMessages(params.messages);
  let anthropicStream;

  try {
    anthropicStream = await createClient(apiKey).messages.create({
      model: mapDeepSeekModel(params.model),
      max_tokens: params.max_tokens || 8192,
      system,
      messages: history,
      stream: true,
      // DeepSeek 的 anthropic 兼容层只识别 type: "enabled" | "disabled",
      // 不支持原生 Anthropic 的 "adaptive"。传 "adaptive" 会被上游直接 400。
      // Anthropic SDK 的 ThinkingConfigEnabled 要求 budget_tokens,
      // 而 DeepSeek 上游并不消费这个字段,所以用 as any 跳过类型校验。
      ...(params.thinking?.type === "enabled"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? { thinking: { type: "enabled" } as any }
        : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(params.tools?.length ? { tools: params.tools as any } : {}),
    });
  } catch (error) {
    throw toDeepSeekError(error);
  }

  let usage: DeepSeekUsage | null = null;
  const toolCalls: ToolUseBlock[] = [];
  const encoder = new TextEncoder();

  // Track current tool_use block being built
  let currentToolUse: { id: string; name: string; inputJson: string } | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let promptTokens = 0;
      let completionTokens = 0;
      let cacheHitTokens = 0;
      let cacheMissTokens = 0;

      function flushToolUse() {
        if (!currentToolUse) return;
        try {
          const input = currentToolUse.inputJson
            ? JSON.parse(currentToolUse.inputJson)
            : {};
          toolCalls.push({
            id: currentToolUse.id,
            name: currentToolUse.name,
            input,
          });

          // Emit tool call event to frontend
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                tool_call: {
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input,
                },
              })}\n\n`
            )
          );
        } catch {
          // Invalid JSON — skip this tool call
        }
        currentToolUse = null;
      }

      try {
        for await (const event of anthropicStream) {
          if (event.type === "message_start") {
            const rawUsage = event.message.usage as unknown as Record<string, number>;
            promptTokens = rawUsage.input_tokens || 0;
            cacheHitTokens = rawUsage.prompt_cache_hit_tokens || rawUsage.cache_read_input_tokens || 0;
            cacheMissTokens = rawUsage.prompt_cache_miss_tokens || rawUsage.cache_creation_input_tokens || 0;
          } else if (event.type === "content_block_start") {
            const block = event.content_block as unknown as {
              type: string;
              id?: string;
              name?: string;
              text?: string;
            };

            // Flush previous tool_use if switching to a new block
            if (currentToolUse && block.type !== "tool_use") {
              flushToolUse();
            }

            if (block.type === "tool_use" && block.id) {
              currentToolUse = {
                id: block.id,
                name: block.name || "unknown",
                inputJson: "",
              };
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta as unknown as {
              type: string;
              text?: string;
              thinking?: string;
              partial_json?: string;
            };

            if (delta.type === "input_json_delta" && delta.partial_json && currentToolUse) {
              currentToolUse.inputJson += delta.partial_json;
            } else if (delta.type === "text_delta") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    choices: [{ delta: { content: delta.text || "" } }],
                  })}\n\n`
                )
              );
            } else if (delta.type === "thinking_delta") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    choices: [{ delta: { reasoning_content: delta.thinking || "" } }],
                  })}\n\n`
                )
              );
            }
          } else if (event.type === "content_block_stop") {
            // Flush any pending tool_use when block stops
            if (currentToolUse) {
              flushToolUse();
            }
          } else if (event.type === "message_delta") {
            completionTokens = event.usage.output_tokens || 0;
          }
        }

        // Flush any remaining tool_use at end of stream
        if (currentToolUse) {
          flushToolUse();
        }

        usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          prompt_cache_hit_tokens: cacheHitTokens,
          prompt_cache_miss_tokens: cacheMissTokens,
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ usage })}\n\n`)
        );

        // Emit tool calls summary
        if (toolCalls.length > 0) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ tool_calls: toolCalls.map(tc => ({ id: tc.id, name: tc.name })) })}\n\n`
            )
          );
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(toDeepSeekError(error));
      }
    },
  });

  return { stream, getUsage: () => usage, getToolCalls: () => toolCalls };
}
