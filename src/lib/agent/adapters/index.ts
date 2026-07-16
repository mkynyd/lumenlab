import { DeepSeekAdapter } from "./deepseek-adapter";
import { MiniMaxAdapter } from "./minimax-adapter";
import { PiAiAdapter } from "./pi-ai-adapter";
import { BailianQwenAdapter } from "./bailian-qwen-adapter";
import type { ProviderAdapter } from "@/lib/agent/provider-adapter";
import type { ProviderName } from "@/lib/agent/contracts";

export type ProviderAdapterLayer = "legacy" | "pi";

export function resolveProviderAdapterLayer(
  value = process.env.AGENT_PROVIDER_ADAPTER
): ProviderAdapterLayer {
  // pi-ai remains a temporary backwards-compatible alias for the initial POC.
  return value === "pi" || value === "pi-ai" ? "pi" : "legacy";
}

export function createProviderAdapter(
  provider: ProviderName,
  apiKey: string,
  layer = resolveProviderAdapterLayer()
): ProviderAdapter {
  if (provider === "bailian") {
    return new BailianQwenAdapter(apiKey, bailianQwenBaseUrl());
  }
  if (layer === "pi") {
    return new PiAiAdapter(provider, apiKey);
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
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`;
}

export { DeepSeekAdapter, MiniMaxAdapter, PiAiAdapter, BailianQwenAdapter };
export type { ProviderAdapter };
