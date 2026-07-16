import type { AgentSource } from "./sources";
import type { AgentEvent as OperationalAgentEvent } from "./types";
import type { AgentUsage } from "./contracts";

/**
 * Runtime events include the existing operational timeline events plus model
 * deltas and terminal completion. HTTP/SSE adapters decide how each event is
 * encoded for the current client contract.
 */
export type AgentRuntimeEvent =
  | OperationalAgentEvent
  | { type: "model_started"; provider: "deepseek" | "minimax" | "bailian"; model: string }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "usage"; usage: AgentUsage }
  | { type: "sources_updated"; sources: AgentSource[] }
  | { type: "completed"; conversationId: string; messageId: string };
