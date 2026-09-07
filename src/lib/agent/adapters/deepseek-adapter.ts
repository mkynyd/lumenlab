import {
  buildDeepSeekResponsesBody,
  fromResponsesToolName,
  toResponsesToolName,
} from "@/lib/agent/providers/responses/serialize";
import { prepareResponsesMessages, responsesModel, streamResponsesAdapter } from "@/lib/agent/providers/responses/adapter-stream";

import type {
  ProviderAdapter,
  AdapterStreamParams,
  AdapterStreamResult,
  ProviderContinuationInput,
  ProviderRound,
  ProviderRoundInput,
  ProviderToolProtocol,
} from "@/lib/agent/provider-adapter";
import {
  createProviderRound,
} from "@/lib/agent/provider-adapter";
import type { DeepSeekContentBlock, DeepSeekMessage } from "@/lib/deepseek";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import type { ToolMetadata } from "@/lib/agent/types";
import "@/lib/tools/registry";

const NATIVE_TOOL_NAMES: Record<string, string> = {
  "web.search": "web_search",
};

const INTERNAL_TOOL_NAMES = Object.fromEntries(
  Object.entries(NATIVE_TOOL_NAMES).map(([toolId, nativeName]) => [nativeName, toolId])
) as Record<string, string>;

export class DeepSeekAdapter implements ProviderAdapter {
  readonly provider = "deepseek";

  constructor(private readonly apiKey: string) {}

  async stream(params: AdapterStreamParams): Promise<AdapterStreamResult> {
    return streamResponsesAdapter({
      apiKey: this.apiKey,
      baseUrl: "https://api.deepseek.com",
      signal: params.signal,
      body: buildDeepSeekResponsesBody({
        ...params,
        model: responsesModel(params.model, "deepseek"),
        messages: prepareResponsesMessages(params),
        attachments: [],
        maxOutputTokens: 8192,
        toolChoice: params.tools?.length ? "auto" : "none",
      }),
    });
  }

  toolProtocol(activeTools: ToolMetadata[]): ProviderToolProtocol {
    return activeTools.length === 0 ? "none" : "native";
  }

  async startRound(params: ProviderRoundInput): Promise<ProviderRound> {
    const messages = prepareResponsesMessages(params);
    const result = await this.stream({
      ...params,
      messages,
      tools: params.activeTools.map((tool) => ({
        name: this.toNativeToolName(tool.toolId),
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    });
    return createProviderRound(result, (name) => this.fromNativeToolName(name), messages);
  }

  async continueRound(params: ProviderContinuationInput): Promise<ProviderRound> {
    const messages = this.buildContinuationMessages(params);
    return this.startRound({
      ...params,
      messages: params.stopInstruction
        ? [
            ...messages,
            { role: "user", content: params.stopInstruction } as DeepSeekMessage,
          ]
        : messages,
      activeTools: params.stopInstruction ? [] : params.activeTools,
    });
  }

  private toNativeToolName(toolId: string) {
    return NATIVE_TOOL_NAMES[toolId] ?? toResponsesToolName(toolId);
  }

  private fromNativeToolName(name: string) {
    return INTERNAL_TOOL_NAMES[name] ?? fromResponsesToolName(name);
  }

  private buildContinuationMessages(
    params: ProviderContinuationInput
  ): DeepSeekMessage[] {
    const assistantContent: DeepSeekContentBlock[] = [];
    const sanitizedText = sanitizeModelText(params.rawContent);
    if (sanitizedText) assistantContent.push({ type: "text", text: sanitizedText });
    const nativeCallIds = new Set<string>();
    for (const call of params.toolCalls) {
      if (call.source !== "native") continue;
      nativeCallIds.add(call.id);
      assistantContent.push({
        type: "tool_use",
        id: call.id,
        name: this.toNativeToolName(call.name),
        input: call.input,
      });
    }

    const userContent: DeepSeekContentBlock[] = params.toolResults
      .filter((result) => nativeCallIds.has(result.toolUseId))
      .map((result) => ({
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
