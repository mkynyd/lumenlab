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
    const result = await streamMiniMaxChat(this.apiKey, {
      messages: params.messages,
      attachments: params.attachments,
      thinking: params.thinkingEnabled,
      maxTokens: 8192,
    });

    // MiniMax does not currently expose native tool calls; wrap getToolCalls as a no-op.
    return {
      stream: result.stream,
      getUsage: result.getUsage,
      getToolCalls: () => [],
    };
  }
}
