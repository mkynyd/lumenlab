import { streamChat, type DeepSeekRequest } from "@/lib/deepseek";
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
  appendSystemInstructions,
  createProviderRound,
  formatFallbackToolInstructions,
} from "@/lib/agent/provider-adapter";
import type { DeepSeekContentBlock, DeepSeekMessage } from "@/lib/deepseek";
import { parseToolCalls, sanitizeModelText } from "@/lib/agent/tool-call-parser";
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
    const request: DeepSeekRequest = {
      model: params.model,
      messages: params.messages,
      thinking: params.thinkingEnabled
        ? { type: "enabled" }
        : { type: "disabled" },
      reasoning_effort: params.reasoningEffort,
      ...(params.tools?.length ? { tools: params.tools } : {}),
    };
    return params.signal
      ? streamChat(this.apiKey, request, params.signal)
      : streamChat(this.apiKey, request);
  }

  toolProtocol(activeTools: ToolMetadata[]): ProviderToolProtocol {
    if (activeTools.length === 0) return "none";
    return activeTools.some((tool) => !this.supportsNativeTool(tool.toolId))
      ? "native+xml_dsml"
      : "native";
  }

  async startRound(params: ProviderRoundInput): Promise<ProviderRound> {
    const nativeTools = params.activeTools.filter((tool) =>
      this.supportsNativeTool(tool.toolId)
    );
    const fallbackTools = params.activeTools.filter(
      (tool) => !this.supportsNativeTool(tool.toolId)
    );
    const messages = appendSystemInstructions(
      params.messages,
      formatFallbackToolInstructions(fallbackTools)
    );
    const result = await this.stream({
      ...params,
      messages,
      tools: nativeTools.map((tool) => ({
        name: this.toNativeToolName(tool.toolId),
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    });
    return createProviderRound(
      result,
      (name) => this.fromNativeToolName(name),
      messages,
      () =>
        parseToolCalls(`${result.getRawReasoning()}\n${result.getRawContent()}`).map(
          (call, index) => ({
            id: `parsed-${call.name}-${index}`,
            name: call.name,
            input: call.input,
            source: "xml_dsml" as const,
          })
        )
    );
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

  private supportsNativeTool(toolId: string) {
    return toolId === "web.search";
  }

  private toNativeToolName(toolId: string) {
    return NATIVE_TOOL_NAMES[toolId] ?? toolId;
  }

  private fromNativeToolName(name: string) {
    return INTERNAL_TOOL_NAMES[name] ?? name;
  }

  private buildContinuationMessages(
    params: ProviderContinuationInput
  ): DeepSeekMessage[] {
    const assistantContent: DeepSeekContentBlock[] = [];
    const sanitizedText = sanitizeModelText(params.rawContent);
    if (sanitizedText) assistantContent.push({ type: "text", text: sanitizedText });
    const fallbackCalls = params.toolCalls.filter(
      (call) => call.source === "xml_dsml"
    );
    if (fallbackCalls.length > 0 && assistantContent.length === 0) {
      assistantContent.push({
        type: "text",
        text: `调用 XML 工具：${fallbackCalls.map((call) => call.name).join(", ")}`,
      });
    }

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
    const fallbackResults = fallbackCalls
      .map((call) => {
        const result = params.toolResults.find((item) => item.toolUseId === call.id);
        return `${call.name}: ${result?.content ?? "工具未返回结果"}`;
      });
    if (fallbackResults.length > 0) {
      userContent.push({
        type: "text",
        text: `# XML 工具结果\n\n${fallbackResults.join("\n\n")}`,
      });
    }

    return [
      ...params.messages,
      { role: "assistant", content: assistantContent },
      { role: "user", content: userContent },
    ];
  }
}
