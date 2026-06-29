import { streamChat, type DeepSeekRequest } from "@/lib/deepseek";
import type {
  ProviderAdapter,
  AdapterStreamParams,
  AdapterStreamResult,
} from "@/lib/agent/provider-adapter";

export class DeepSeekAdapter implements ProviderAdapter {
  readonly provider = "deepseek";

  constructor(private readonly apiKey: string) {}

  async stream(params: AdapterStreamParams): Promise<AdapterStreamResult> {
    const request: DeepSeekRequest = {
      model: params.model,
      messages: params.messages,
      thinking: params.thinkingEnabled
        ? { type: "enabled" }
        : { type: "disabled" },
      reasoning_effort: params.reasoningEffort,
      ...(params.tools?.length ? { tools: params.tools } : {}),
    };
    return streamChat(this.apiKey, request);
  }
}
