import type { AgentModel, ProviderName } from "@/lib/agent/contracts";
import type { ResearchRole } from "./contracts";

export interface ResearchModelSelection {
  role: ResearchRole;
  provider: ProviderName;
  model: AgentModel;
  reasoningEffort: "high" | "max";
  source: "default" | "environment";
}

const DEFAULTS: Record<ResearchRole, Omit<ResearchModelSelection, "role" | "source">> = {
  "research.planner": { provider: "deepseek", model: "deepseek-v4-pro", reasoningEffort: "high" },
  "research.worker": { provider: "deepseek", model: "deepseek-v4-flash", reasoningEffort: "high" },
  "research.evaluator": { provider: "deepseek", model: "deepseek-v4-pro", reasoningEffort: "high" },
  "research.synthesizer": { provider: "deepseek", model: "deepseek-v4-pro", reasoningEffort: "max" },
  "research.verifier": { provider: "deepseek", model: "deepseek-v4-pro", reasoningEffort: "high" },
};

const ROLES: ResearchRole[] = ["research.planner", "research.worker", "research.evaluator", "research.synthesizer", "research.verifier"];

export function isResearchRole(value: string): value is ResearchRole {
  return ROLES.includes(value as ResearchRole);
}

export function selectResearchModel(role: ResearchRole): ResearchModelSelection {
  const fallback = DEFAULTS[role];
  const configured = process.env[`RESEARCH_MODEL_${role.replace(/[^A-Z0-9]+/gi, "_").toUpperCase()}`]?.trim();
  if (!configured || !isAgentModel(configured)) return { role, ...fallback, source: "default" };
  return { role, provider: providerForModel(configured), model: configured, reasoningEffort: role === "research.synthesizer" ? "max" : "high", source: "environment" };
}

export function researchModelConfiguration(): Record<ResearchRole, ResearchModelSelection> {
  return Object.fromEntries(ROLES.map((role) => [role, selectResearchModel(role)])) as Record<ResearchRole, ResearchModelSelection>;
}

function isAgentModel(value: string): value is AgentModel {
  return value === "deepseek-v4-pro" || value === "deepseek-v4-flash" || value === "minimax-m3" || value === "qwen3.7-plus";
}

function providerForModel(model: AgentModel): ProviderName {
  if (model === "minimax-m3") return "minimax";
  if (model === "qwen3.7-plus") return "bailian";
  return "deepseek";
}
