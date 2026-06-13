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
}

export interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface StreamResult {
  stream: ReadableStream<Uint8Array>;
  getUsage: () => DeepSeekUsage | null;
}

export const DEEPSEEK_ERROR_MAP: Record<number, string> = {
  400: "请求无效，请检查消息格式",
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
    return new DeepSeekError(error.status, DEEPSEEK_ERROR_MAP[error.status]);
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
      ...(params.thinking?.type === "enabled"
        ? { thinking: { type: "adaptive" as const } }
        : {}),
    });
  } catch (error) {
    throw toDeepSeekError(error);
  }

  let usage: DeepSeekUsage | null = null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let promptTokens = 0;
      let completionTokens = 0;
      let cacheHitTokens = 0;
      let cacheMissTokens = 0;

      try {
        for await (const event of anthropicStream) {
          if (event.type === "message_start") {
            const rawUsage = event.message.usage as unknown as Record<string, number>;
            promptTokens = rawUsage.input_tokens || 0;
            cacheHitTokens = rawUsage.prompt_cache_hit_tokens || rawUsage.cache_read_input_tokens || 0;
            cacheMissTokens = rawUsage.prompt_cache_miss_tokens || rawUsage.cache_creation_input_tokens || 0;
          } else if (event.type === "content_block_delta") {
            const delta = event.delta as unknown as {
              type: string;
              text?: string;
              thinking?: string;
            };
            const payload =
              delta.type === "text_delta"
                ? { content: delta.text || "" }
                : delta.type === "thinking_delta"
                  ? { reasoning_content: delta.thinking || "" }
                  : null;

            if (payload) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    choices: [{ delta: payload }],
                  })}\n\n`
                )
              );
            }
          } else if (event.type === "message_delta") {
            completionTokens = event.usage.output_tokens || 0;
          }
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
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(toDeepSeekError(error));
      }
    },
  });

  return { stream, getUsage: () => usage };
}
