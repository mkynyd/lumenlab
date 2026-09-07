import type { DeepSeekContentBlock, DeepSeekMessage } from "@/lib/deepseek";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import type { AdapterStreamParams, AdapterStreamResult, ProviderAdapter, ProviderContinuationInput, ProviderRound, ProviderRoundInput, ProviderToolProtocol } from "@/lib/agent/provider-adapter";
import { createProviderRound } from "@/lib/agent/provider-adapter";
import type { ToolMetadata } from "@/lib/agent/types";
import { fromResponsesToolName, buildQwenResponsesBody } from "@/lib/agent/providers/responses/serialize";
import { prepareResponsesMessages, responsesModel, streamResponsesAdapter } from "@/lib/agent/providers/responses/adapter-stream";
import { BailianQwenNativeAdapter } from "./bailian-qwen-native";

export class BailianQwenError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "BailianQwenError";
  }
}

function hasVideoMedia(params: {
  attachments?: Array<{ mimeType: string }>;
  messages?: DeepSeekMessage[];
}): boolean {
  const mimeTypes = [
    ...(params.attachments ?? []).map((attachment) => attachment.mimeType),
    ...(params.messages ?? []).flatMap((message) =>
      (message.attachments ?? []).map((attachment) => attachment.mimeType)
    ),
  ];
  return mimeTypes.some((mimeType) => mimeType.startsWith("video/"));
}

/**
 * Qwen adapter: text/image traffic uses Responses; requests that carry video
 * attachments delegate to the DashScope native compatibility path, which
 * remains the only endpoint with verified video understanding (task 04).
 */
export class BailianQwenAdapter implements ProviderAdapter {
  readonly provider = "bailian" as const;
  private readonly native: BailianQwenNativeAdapter;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {
    // 原生端点与 Responses 工作空间域名不同：去掉 compatible-mode 后缀回到
    // DashScope API 根；若传入的 baseUrl 已是原生形态则原样使用。
    const nativeBase = baseUrl.includes("/compatible-mode")
      ? baseUrl.replace(/\/compatible-mode\/v1\/?$/, "/api/v1")
      : baseUrl;
    this.native = new BailianQwenNativeAdapter(apiKey, nativeBase);
  }

  async stream(params: AdapterStreamParams): Promise<AdapterStreamResult> {
    return streamResponsesAdapter({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      signal: params.signal,
      body: buildQwenResponsesBody({
        ...params,
        model: responsesModel(params.model, "bailian"),
        messages: prepareResponsesMessages(params),
        attachments: [],
        maxOutputTokens: 8192,
      }),
    });
  }

  toolProtocol(activeTools: ToolMetadata[]): ProviderToolProtocol {
    return activeTools.length > 0 ? "native" : "none";
  }

  async startRound(params: ProviderRoundInput): Promise<ProviderRound> {
    if (hasVideoMedia(params)) {
      return this.native.startRound(params);
    }
    const messages = prepareResponsesMessages(params);
    const result = await this.stream({
      ...params, messages, attachments: [],
      tools: params.activeTools.map((tool) => ({ name: tool.toolId, description: tool.description, input_schema: tool.inputSchema })),
    });
    return createProviderRound(result, fromResponsesToolName, messages);
  }

  async continueRound(params: ProviderContinuationInput): Promise<ProviderRound> {
    if (hasVideoMedia(params)) {
      return this.native.continueRound(params);
    }
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
