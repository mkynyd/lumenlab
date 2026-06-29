import { DeepSeekAdapter } from "./deepseek-adapter";
import { MiniMaxAdapter } from "./minimax-adapter";
import type { ProviderAdapter } from "@/lib/agent/provider-adapter";

export function createProviderAdapter(
  provider: "deepseek" | "minimax",
  apiKey: string
): ProviderAdapter {
  if (provider === "minimax") {
    return new MiniMaxAdapter(apiKey);
  }
  return new DeepSeekAdapter(apiKey);
}

export { DeepSeekAdapter, MiniMaxAdapter };
export type { ProviderAdapter };
