import { prisma } from "@/lib/db";
import { runResearchModelStage, type ResearchModelStageResult } from "@/lib/research/model-stage";
import type { AcademicDocument } from "./document-schema";

export type ImportSuggestedKind = "paragraph" | "heading" | "figure" | "table" | "equation" | "bibliography" | "raw_latex";

export interface ImportClassificationSuggestion {
  index: number;
  kind: ImportSuggestedKind;
  confidence: number;
  reason: string;
}

export interface ImportClassificationResult {
  status: "completed" | "unavailable";
  model: string;
  suggestions: ImportClassificationSuggestion[];
}

interface RawClassification {
  suggestions?: Array<Partial<ImportClassificationSuggestion>>;
}

function clampConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function normalizeImportClassification(value: unknown, validIndexes: Set<number>): ImportClassificationSuggestion[] {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as RawClassification : {};
  if (!Array.isArray(raw.suggestions)) return [];
  return raw.suggestions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const index = typeof item.index === "number" ? Math.floor(item.index) : -1;
    const kind = item.kind;
    if (!validIndexes.has(index) || !["paragraph", "heading", "figure", "table", "equation", "bibliography", "raw_latex"].includes(kind ?? "")) return [];
    const reason = typeof item.reason === "string" ? item.reason.trim().slice(0, 300) : "需要用户确认结构";
    return [{ index, kind: kind as ImportSuggestedKind, confidence: clampConfidence(item.confidence), reason }];
  }).slice(0, 20);
}

function promptFor(input: { sourceType: string; document: AcademicDocument; ambiguous: Array<{ index: number; reason: string; block: unknown }> }) {
  return [
    "你是 LumenLab 论文导入结构审阅器。只对给出的低置信度块提出结构建议，不生成正文，不生成 LaTeX，不联网。",
    "输出严格 JSON：{\"suggestions\":[{\"index\":number,\"kind\":\"paragraph|heading|figure|table|equation|bibliography|raw_latex\",\"confidence\":0到1,\"reason\":\"面向用户的一句话\"}]}。",
    "只返回输入中存在的 index；无法判断就不输出该项。建议必须等待用户在结构确认页接受，不得视为已经修改 Document。",
    `来源格式：${input.sourceType}`,
    JSON.stringify(input.ambiguous),
  ].join("\n\n");
}

async function createEphemeralConversation(userId: string, model: string) {
  return prisma.conversation.create({
    data: {
      userId,
      title: "论文导入结构分类",
      model,
      thinkingEnabled: false,
      kind: "research-system",
    },
    select: { id: true },
  });
}

export async function classifyAmbiguousPaperImport(input: {
  userId: string;
  sourceType: string;
  document: AcademicDocument;
  lowConfidenceBlocks: Array<{ index: number; reason: string }>;
}): Promise<ImportClassificationResult> {
  const validIndexes = new Set(input.lowConfidenceBlocks.map((item) => item.index).filter((index) => index >= 0 && index < input.document.blocks.length));
  if (validIndexes.size === 0) return { status: "unavailable", model: "none", suggestions: [] };
  const model = "deepseek-v4-pro";
  let conversationId: string | null = null;
  let result: ResearchModelStageResult<RawClassification> | null = null;
  try {
    conversationId = (await createEphemeralConversation(input.userId, model)).id;
    result = await runResearchModelStage({
      role: "research.evaluator",
      userId: input.userId,
      conversationId,
      projectId: null,
      signal: AbortSignal.timeout(25_000),
      prompt: promptFor({
        sourceType: input.sourceType,
        document: input.document,
        ambiguous: input.lowConfidenceBlocks.map((item) => ({ index: item.index, reason: item.reason, block: input.document.blocks[item.index] ?? null })),
      }),
    });
    const suggestions = normalizeImportClassification(result.value, validIndexes);
    return { status: suggestions.length > 0 ? "completed" : "unavailable", model: result.model, suggestions };
  } catch {
    return { status: "unavailable", model: result?.model ?? model, suggestions: [] };
  } finally {
    if (conversationId) await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => {});
  }
}
