import { prisma } from "@/lib/db";
import { runAgentRuntime } from "@/lib/agent/runtime";
import type { AgentModel, AgentUsage } from "@/lib/agent/contracts";
import type { ResearchRole } from "./contracts";
import { selectResearchModel } from "./model-routing";

export interface ResearchModelStageInput {
  role: ResearchRole;
  userId: string;
  conversationId: string;
  projectId: string | null;
  signal: AbortSignal;
  prompt: string;
  parse?: (content: string) => unknown;
}

export interface ResearchModelStageResult<T> {
  value: T | null;
  model: AgentModel;
  usage: AgentUsage | null;
  attempted: boolean;
}

/**
 * Runs a bounded, non-networking structured stage through the existing Agent
 * Runtime. The response is intentionally read from the persisted assistant
 * message; reasoning and tool events never cross this domain boundary.
 */
export async function runResearchModelStage<T>(input: ResearchModelStageInput): Promise<ResearchModelStageResult<T>> {
  const selection = selectResearchModel(input.role);
  let attempted = false;
  try {
    attempted = true;
    const run = await runAgentRuntime({
      user: { id: input.userId },
      conversation: { id: input.conversationId, ...(input.projectId ? { projectId: input.projectId } : {}) },
      prompt: { message: input.prompt, attachments: [] },
      model: { requestedModel: selection.model, thinkingEnabled: false, reasoningEffort: selection.reasoningEffort },
      capabilities: { webSearchActive: false, skillOff: true, selectedFileIds: [], isQuickTask: false, mode: "general" },
      signal: input.signal,
    });
    for await (const event of run.events) {
      if (event.type === "completed") break;
    }
    const completion = await run.completion;
    if (completion.status !== "completed") return { value: null, model: selection.model, usage: completion.usage, attempted };
    const message = await prisma.message.findUnique({ where: { id: completion.messageId }, select: { content: true } });
    return {
      value: (input.parse ? input.parse(message?.content ?? "") : parseStructuredJson<T>(message?.content ?? "")) as T | null,
      model: selection.model,
      usage: completion.usage,
      attempted,
    };
  } catch {
    return { value: null, model: selection.model, usage: null, attempted };
  }
}

export function parseStructuredJson<T>(content: string): T | null {
  const normalized = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (!normalized) return null;
  const candidates = [normalized];
  const firstObject = normalized.indexOf("{");
  const lastObject = normalized.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) candidates.push(normalized.slice(firstObject, lastObject + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return parsed as T;
    } catch {
      // Try the next bounded candidate; never expose raw model text as a stage result.
    }
  }
  return null;
}

export interface ResearchWorkerDecision {
  queries: string[];
  rationale?: string;
}

export function normalizeResearchWorkerDecision(value: unknown, fallback: string): ResearchWorkerDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const queries = Array.isArray(record.queries)
    ? record.queries.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 3)
    : [];
  return {
    queries: queries.length > 0 ? queries : [fallback],
    rationale: typeof record.rationale === "string" ? record.rationale.slice(0, 1_000) : undefined,
  };
}

export type ResearchEvaluationStatus = "resolved" | "partially_resolved" | "unresolved" | "controversial";

export interface ResearchEvaluatorDecision {
  status: ResearchEvaluationStatus;
  coverage: number;
  directness: number;
  gap?: string;
  followUpQueries?: string[];
}

export function normalizeResearchEvaluatorDecision(value: unknown, fallback: ResearchEvaluatorDecision): ResearchEvaluatorDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const status = record.status === "resolved" || record.status === "partially_resolved" || record.status === "unresolved" || record.status === "controversial" ? record.status : fallback.status;
  const numberOr = (candidate: unknown, defaultValue: number) => typeof candidate === "number" && Number.isFinite(candidate) ? Math.max(0, Math.min(1, candidate)) : defaultValue;
  const followUpQueries = Array.isArray(record.followUpQueries)
    ? record.followUpQueries.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 3)
    : fallback.followUpQueries;
  return {
    status,
    coverage: numberOr(record.coverage, fallback.coverage),
    directness: numberOr(record.directness, fallback.directness),
    gap: typeof record.gap === "string" ? record.gap.slice(0, 2_000) : fallback.gap,
    followUpQueries,
  };
}

export type ResearchVerificationStatus = "verified" | "needs_qualification" | "unsupported" | "conflicted";

export interface ResearchVerifierDecision {
  claims: Record<string, { status: ResearchVerificationStatus; reasonCode: string }>;
}

export function normalizeResearchVerifierDecision(value: unknown): ResearchVerifierDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const claims: ResearchVerifierDecision["claims"] = {};
  const rawClaims = record.claims && typeof record.claims === "object" && !Array.isArray(record.claims) ? record.claims as Record<string, unknown> : {};
  for (const [claimId, raw] of Object.entries(rawClaims)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const status = item.status === "verified" || item.status === "needs_qualification" || item.status === "unsupported" || item.status === "conflicted" ? item.status : null;
    if (!status) continue;
    claims[claimId] = { status, reasonCode: typeof item.reasonCode === "string" ? item.reasonCode.slice(0, 120) : "model_review" };
  }
  return { claims };
}
