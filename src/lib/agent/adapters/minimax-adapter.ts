import { fromResponsesToolName, buildMiniMaxResponsesBody } from "@/lib/agent/providers/responses/serialize";
import { prepareResponsesMessages, responsesModel, streamResponsesAdapter } from "@/lib/agent/providers/responses/adapter-stream";


import { isTextAttachment } from "@/lib/chat/router";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import type { DeepSeekContentBlock, DeepSeekMessage } from "@/lib/deepseek";
import type { ToolMetadata } from "@/lib/agent/types";
import type {
  ProviderAdapter,
  AdapterStreamParams,
  AdapterStreamResult,
  ProviderContinuationInput,
  ProviderRound,
  ProviderRoundInput,
  ProviderToolProtocol,
} from "@/lib/agent/provider-adapter";
import { createProviderRound } from "@/lib/agent/provider-adapter";

export class MiniMaxAdapter implements ProviderAdapter {
  readonly provider = "minimax";

  constructor(private readonly apiKey: string) {}

  async stream(params: AdapterStreamParams): Promise<AdapterStreamResult> {
    return streamResponsesAdapter({
      apiKey: this.apiKey,
      baseUrl: "https://api.minimax.cn/v1",
      signal: params.signal,
      body: buildMiniMaxResponsesBody({
        ...params,
        model: responsesModel(params.model, "minimax"),
        messages: prepareResponsesMessages(params),
        attachments: [],
        maxOutputTokens: 8192,
        toolChoice: params.tools?.length ? "auto" : "none",
      }),
    });
  }

  toolProtocol(activeTools: ToolMetadata[]): ProviderToolProtocol {
    return activeTools.length > 0 ? "native" : "none";
  }

  async startRound(params: ProviderRoundInput): Promise<ProviderRound> {
    const messages = prepareResponsesMessages(params);
    const result = await this.stream({
      ...params,
      messages,
      attachments: params.attachments?.filter((attachment) =>
        !isTextAttachment(attachment)
      ),
      tools: params.activeTools.map((tool) => ({
        name: tool.toolId,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    });
    return createProviderRound(result, fromResponsesToolName, messages);
  }

  async continueRound(params: ProviderContinuationInput): Promise<ProviderRound> {
    const messages = this.buildContinuationMessages(params);
    return this.startRound({
      ...params,
      attachments: [],
      messages: params.stopInstruction
        ? [
            ...messages,
            { role: "user", content: params.stopInstruction } as DeepSeekMessage,
          ]
        : messages,
      activeTools: params.stopInstruction ? [] : params.activeTools,
    });
  }

  private buildContinuationMessages(
    params: ProviderContinuationInput
  ): DeepSeekMessage[] {
    const assistantContent: DeepSeekContentBlock[] = [];
    const sanitizedText = sanitizeModelText(params.rawContent);
    if (sanitizedText) assistantContent.push({ type: "text", text: sanitizedText });
    for (const call of params.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      });
    }
    const userContent: DeepSeekContentBlock[] = params.toolResults.map((result) => ({
      type: "tool_result",
      tool_use_id: result.toolUseId,
      content: result.content,
    }));
    return [
      ...params.messages,
      { role: "assistant", content: assistantContent },
      { role: "user", content: userContent },
    ];
  }
}
