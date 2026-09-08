import { DeepSeekAdapter } from "./deepseek-adapter";
import { MiniMaxAdapter } from "./minimax-adapter";
import { PiAiAdapter } from "./pi-ai-adapter";
import { BailianQwenAdapter } from "./bailian-qwen-adapter";
import type { ProviderAdapter } from "@/lib/agent/provider-adapter";
import type { ProviderName } from "@/lib/agent/contracts";
import { ResponsesConfigurationError } from "@/lib/agent/providers/responses/adapter-stream";

export type ProviderAdapterLayer = "responses" | "legacy" | "pi";

export function resolveProviderAdapterLayer(
  value = process.env.AGENT_PROVIDER_ADAPTER
): ProviderAdapterLayer {
  // Legacy remains a configuration alias for the project's own adapters.
  if (value === "pi" || value === "pi-ai") return "pi";
  return value === "legacy" ? "legacy" : "responses";
}

export function createProviderAdapter(
  provider: ProviderName,
  apiKey: string,
  layer = resolveProviderAdapterLayer()
): ProviderAdapter {
  if (process.env[`AGENT_RESPONSES_${provider.toUpperCase()}_ENABLED`] === "false") {
    throw new ResponsesConfigurationError(`${provider} Responses 暂停服务`);
  }
  if (layer === "pi") {
    throw new ResponsesConfigurationError("旧 Pi 协议不支持当前活跃模型配置，请使用 Responses adapter");
  }
  if (provider === "bailian") {
    return new BailianQwenAdapter(apiKey, bailianQwenBaseUrl());
  }
  if (provider === "minimax") {
    return new MiniMaxAdapter(apiKey);
  }
  return new DeepSeekAdapter(apiKey);
}

function bailianQwenBaseUrl() {
  const workspaceId = process.env.BAILIAN_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    throw new Error("Qwen 尚未配置百炼工作空间");
  }
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`;
}

export { DeepSeekAdapter, MiniMaxAdapter, PiAiAdapter, BailianQwenAdapter };
export type { ProviderAdapter };
