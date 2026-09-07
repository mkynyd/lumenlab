import type { DeepSeekContentBlock, DeepSeekMessage } from "@/lib/deepseek";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import type { AdapterStreamParams, AdapterStreamResult, ProviderAdapter, ProviderContinuationInput, ProviderRound, ProviderRoundInput, ProviderToolProtocol } from "@/lib/agent/provider-adapter";
import { createProviderRound } from "@/lib/agent/provider-adapter";
import type { ToolMetadata } from "@/lib/agent/types";
import { fromResponsesToolName, buildQwenResponsesBody } from "@/lib/agent/providers/responses/serialize";
import { prepareResponsesMessages, responsesModel, streamResponsesAdapter } from "@/lib/agent/providers/responses/adapter-stream";

export class BailianQwenError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "BailianQwenError";
  }
}

/** Qwen Responses replays platform history. Video/audio are not supported by this endpoint. */
export class BailianQwenAdapter implements ProviderAdapter {
  readonly provider = "bailian" as const;
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

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
    const messages = prepareResponsesMessages(params);
    const result = await this.stream({
      ...params, messages, attachments: [],
      tools: params.activeTools.map((tool) => ({ name: tool.toolId, description: tool.description, input_schema: tool.inputSchema })),
    });
    return createProviderRound(result, fromResponsesToolName, messages);
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