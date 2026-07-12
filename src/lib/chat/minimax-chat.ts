import Anthropic from "@anthropic-ai/sdk";
import type { DeepSeekMessage, DeepSeekUsage, ToolUseBlock } from "@/lib/deepseek";
import type { ServerFileAttachment } from "@/lib/chat/router";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";

const MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";

export class MiniMaxChatError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "MiniMaxChatError";
  }
}

function createClient(apiKey: string) {
  return new Anthropic({
    baseURL: MINIMAX_BASE_URL,
    apiKey,
    timeout: 300_000,
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

function contentBlockForAttachment(attachment: ServerFileAttachment) {
  const data = attachment.data.toString("base64");
  if (attachment.mimeType.startsWith("image/")) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data,
      },
    };
  }

  return {
    type: "document",
    source: {
      type: "base64",
      media_type: attachment.mimeType || "application/octet-stream",
      data,
    },
    title: attachment.name,
  } as never;
}

function applyAttachmentsToLastUserMessage(
  messages: Array<{ role: "user" | "assistant"; content: string | unknown }>,
  attachments: ServerFileAttachment[]
) {
  if (attachments.length === 0) return messages;
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return messages;

  return messages.map((message, index) => {
    if (index !== lastUserIndex) return message;
    const text =
      typeof message.content === "string"
        ? message.content || "请阅读附件并回答。"
        : "请阅读附件并回答。";
    return {
      ...message,
      content: [
        { type: "text", text },
        ...attachments.map(contentBlockForAttachment),
      ],
    } as (typeof messages)[number];
  });
}

function toMiniMaxError(error: unknown): MiniMaxChatError {
  if (error instanceof Anthropic.APIError) {
    const messages: Record<number, string> = {
      400: "MiniMax 请求格式无效",
      401: "MiniMax API Key 无效，请在设置中更新",
      413: "附件或请求体超过 MiniMax 限制",
      429: "MiniMax 请求频率过高，请稍后重试",
      500: "MiniMax 服务异常，请稍后重试",
      529: "MiniMax 服务过载，请稍后重试",
    };
    return new MiniMaxChatError(
      error.status,
      messages[error.status] || `MiniMax API 错误 (${error.status})`
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new MiniMaxChatError(0, "请求超时，请重试");
  }
  return new MiniMaxChatError(0, "无法连接 MiniMax API，请稍后重试");
}

export async function streamMiniMaxChat(
  apiKey: string,
  params: {
    messages: DeepSeekMessage[];
    attachments?: ServerFileAttachment[];
    thinking?: boolean;
    maxTokens?: number;
    signal?: AbortSignal;
    tools?: Array<{ type?: string; name: string; description?: string; input_schema?: Record<string, unknown> }>;
    toolChoice?: { type: "auto" | "any" | "none" };
  }
): Promise<{
  stream: ReadableStream<Uint8Array>;
  getUsage: () => DeepSeekUsage | null;
  getToolCalls: () => ToolUseBlock[];
  getRawContent: () => string;
  getRawReasoning: () => string;
}> {
  const { system, history } = splitMessages(params.messages);
  let anthropicStream: AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>;

  try {
    const request = {
      model: "MiniMax-M3",
      max_tokens: params.maxTokens || 8192,
      temperature: 0.7,
      thinking: params.thinking
        ? ({ type: "enabled", budget_tokens: 4096 } as { type: "enabled"; budget_tokens: number })
        : { type: "disabled" },
      system,
      messages: applyAttachmentsToLastUserMessage(
        history,
        params.attachments || []
      ) as unknown as Anthropic.Messages.MessageParam[],
      stream: true,
      ...(params.tools?.length ? { tools: params.tools as Anthropic.Messages.Tool[] } : {}),
      ...(params.toolChoice ? { tool_choice: params.toolChoice as Anthropic.Messages.ToolChoice } : {}),
    } as Anthropic.Messages.MessageCreateParamsStreaming;
    anthropicStream = params.signal
      ? await createClient(apiKey).messages.create(request, {
          signal: params.signal,
        })
      : await createClient(apiKey).messages.create(request);
  } catch (error) {
    throw toMiniMaxError(error);
  }

  let usage: DeepSeekUsage | null = null;
  const toolCalls: ToolUseBlock[] = [];
  const encoder = new TextEncoder();

  let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
  let rawContent = "";
  let cleanedContentStreamed = "";
  let rawReasoning = "";
  let cleanedReasoningStreamed = "";

  function flushToolUse() {
    if (!currentToolUse) return;
    try {
      const input = currentToolUse.inputJson ? JSON.parse(currentToolUse.inputJson) : {};
      toolCalls.push({
        id: currentToolUse.id,
        name: currentToolUse.name,
        input,
      });
    } catch {
      // Invalid JSON — skip this tool call
    }
    currentToolUse = null;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let promptTokens = 0;
      let completionTokens = 0;

      try {
        for await (const event of anthropicStream) {
          if (event.type === "message_start") {
            promptTokens = event.message.usage.input_tokens || 0;
          } else if (event.type === "content_block_start") {
            const block = event.content_block as unknown as { type: string; id?: string; name?: string };
            if (currentToolUse && block.type !== "tool_use") {
              flushToolUse();
            }
            if (block.type === "tool_use" && block.id) {
              currentToolUse = { id: block.id, name: block.name || "unknown", inputJson: "" };
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
              rawContent += delta.text || "";
              const cleanedContent = sanitizeModelText(rawContent);
              const newCleaned = cleanedContent.slice(cleanedContentStreamed.length);
              cleanedContentStreamed = cleanedContent;
              if (newCleaned) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      choices: [{ delta: { content: newCleaned } }],
                    })}\n\n`
                  )
                );
              }
            } else if (delta.type === "thinking_delta") {
              rawReasoning += delta.thinking || "";
              const cleanedReasoning = sanitizeModelText(rawReasoning);
              const newCleaned = cleanedReasoning.slice(cleanedReasoningStreamed.length);
              cleanedReasoningStreamed = cleanedReasoning;
              if (newCleaned) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      choices: [{ delta: { reasoning_content: newCleaned } }],
                    })}\n\n`
                  )
                );
              }
            }
          } else if (event.type === "content_block_stop") {
            flushToolUse();
          } else if (event.type === "message_delta") {
            completionTokens = event.usage.output_tokens || 0;
          }
        }

        flushToolUse();

        usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ usage })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(toMiniMaxError(error));
      }
    },
  });

  return {
    stream,
    getUsage: () => usage,
    getToolCalls: () => toolCalls,
    getRawContent: () => rawContent,
    getRawReasoning: () => rawReasoning,
  };
}
