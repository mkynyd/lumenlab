import { streamMiniMaxChat } from "@/lib/chat/minimax-chat";
import type {
  ProviderAdapter,
  AdapterStreamParams,
  AdapterStreamResult,
} from "@/lib/agent/provider-adapter";

export class MiniMaxAdapter implements ProviderAdapter {
  readonly provider = "minimax";

  constructor(private readonly apiKey: string) {}

  async stream(params: AdapterStreamParams): Promise<AdapterStreamResult> {
    const tools = params.tools?.length
      ? params.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        }))
      : undefined;
    const result = await streamMiniMaxChat(this.apiKey, {
      messages: params.messages,
      attachments: params.attachments,
      thinking: params.thinkingEnabled,
      maxTokens: 8192,
      ...(tools ? { tools, toolChoice: { type: "auto" } } : {}),
    });

    return {
      stream: result.stream,
      getUsage: result.getUsage,
      getToolCalls: result.getToolCalls,
      getRawContent: result.getRawContent,
      getRawReasoning: result.getRawReasoning,
    };
  }
}
