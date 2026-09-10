/**
 * Deep Research v1 — figure/table visual evidence (bounded, on demand).
 *
 * Scope is deliberately narrow: read ONE figure/table image that a paper's own
 * full text references, when the evidence body is not enough to answer a
 * quantitative comparison. This is not a general vision agent.
 *
 * Invariants enforced here:
 * - Visual analysis is only reached through a deterministic need decision and
 *   a hard per-profile budget; there is no per-paper or per-resource LLM
 *   fan-out. One model call covers up to `maxResourcesPerCall` images.
 * - The model may only see explicitly selected resources plus their bounded
 *   caption/body context. It never receives project files or arbitrary URLs.
 * - Output is strict structured JSON; unknown resource ids, non-finite numbers
 *   and over-long fields are dropped. Model Markdown never becomes evidence.
 * - Persisted Evidence uses `visual_observation` (never `direct_quote`), keeps
 *   full resource provenance, and still has to pass Claim Extraction →
 *   Relation → deterministic floor → model verifier.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer } from "@/lib/storage/object-storage";
import type { ResearchBudgetProfile } from "./contracts";
import { buildResearchEvidenceKey } from "./evidence-ingestion";

export const VISUAL_EVIDENCE_STAGE_VERSION = "research-visual-evidence-v1";
/** 单张图片字节上限（与 tools 层 sciverse.resource 的 4MB 上限保持同一量级）。 */
export const VISUAL_EVIDENCE_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** 一次视觉模型调用最多携带的图片数。 */
export const VISUAL_EVIDENCE_MAX_IMAGES_PER_CALL = 3;
/** 每个 Question 最多持久化的 visual observation 条数。 */
export const VISUAL_EVIDENCE_MAX_OBSERVATIONS = 6;
const STATEMENT_MAX_CHARS = 600;
const SHORT_FIELD_MAX_CHARS = 120;
const CAPTION_MAX_CHARS = 400;

export interface ResearchVisualPolicy {
  enabled: boolean;
  /** 每个 Run 最多做视觉分析的 Question 数。 */
  maxQuestions: number;
  /** 每个 Question 最多抓取的资源数。 */
  maxResourcesPerQuestion: number;
  /** 每个 Run 最多抓取的资源数（硬上限）。 */
  maxResourceFetches: number;
  /** 每个 Run 最多附加读取正文片段以发现图表的次数。 */
  maxFigureScanReads: number;
  /** 每个 Run 最多视觉模型调用数。 */
  maxModelCalls: number;
}

/**
 * quick 默认不做视觉分析（0 次调用）；deep/comprehensive 才在确有需要时扩展。
 * 所有上限都在同一 budget architecture 内，与 search/fetch/modelCalls 同级。
 */
export const RESEARCH_VISUAL_POLICIES: Record<ResearchBudgetProfile, ResearchVisualPolicy> = {
  quick: { enabled: false, maxQuestions: 0, maxResourcesPerQuestion: 0, maxResourceFetches: 0, maxFigureScanReads: 0, maxModelCalls: 0 },
  deep: { enabled: true, maxQuestions: 1, maxResourcesPerQuestion: 2, maxResourceFetches: 3, maxFigureScanReads: 2, maxModelCalls: 1 },
  comprehensive: { enabled: true, maxQuestions: 2, maxResourcesPerQuestion: 3, maxResourceFetches: 6, maxFigureScanReads: 3, maxModelCalls: 2 },
};

export function getResearchVisualPolicy(profile: ResearchBudgetProfile): ResearchVisualPolicy {
  return { ...RESEARCH_VISUAL_POLICIES[profile] };
}

export interface EmptyVisualEvidenceMetrics {
  questionsConsidered: number;
  questionsSelected: number;
  figureScanReads: number;
  resourceFetches: number;
  resourcesPersisted: number;
  modelCalls: number;
  observationsPersisted: number;
  observationsRejected: number;
  budgetStops: number;
  degradations: number;
}

export function emptyVisualEvidenceMetrics(): EmptyVisualEvidenceMetrics {
  return {
    questionsConsidered: 0,
    questionsSelected: 0,
    figureScanReads: 0,
    resourceFetches: 0,
    resourcesPersisted: 0,
    modelCalls: 0,
    observationsPersisted: 0,
    observationsRejected: 0,
    budgetStops: 0,
    degradations: 0,
  };
}

// ─── Deterministic need decision ────────────────────────────────────────────

/**
 * 视觉证据只在两种确定性情形下使用：
 *
 * 1. **问题明确要求图表读数**：同时出现「图表名词」（图表 / 图 N / 表 N / figure /
 *    table / chart / plot / 曲线）与「定量名词」（实测 / 定量 / 数值 / 测量 /
 *    measurement / benchmark 等）。此时用户已经点名要看图里的数字，与 evaluator
 *    的解决状态无关——「有证据」不等于「已经拿到了图表中的数值」。
 * 2. **存在未解决的证据缺口**且问题指向定量比较：只有一类信号时，仍要求
 *    Question 未解决/部分解决/有争议。
 *
 * 两种情形都要求该 Question 已有正文级证据：metadata-only 来源没有正文，也就
 * 没有可定位的图表。是否真的存在图表仍由正文里的确定性图片占位决定。
 */
const EXPLICIT_VISUAL_SIGNALS = [
  "figure",
  "fig.",
  "table",
  "chart",
  "plot",
  "graph",
  "diagram",
  "图表",
  "曲线",
  "示意图",
  "图 ",
  "表 ",
];

const QUANTITATIVE_SIGNALS = [
  "measurement",
  "measured",
  "quantitative",
  "benchmark",
  "throughput",
  "latency",
  "accuracy",
  "实测",
  "测量",
  "数值",
  "定量",
  "对比实验",
  "实验结果",
  "吞吐",
  "延迟",
  "准确率",
];

export interface VisualNeedInput {
  questionText: string;
  /** 该 Question 的完成标准，常包含「比较图表中的指标」这类要求。 */
  completionCriteria?: readonly string[];
  status: string;
  /** 已落库的全文证据条数（metadata-only 证据不参与视觉分析）。 */
  fullTextEvidenceCount: number;
}

export interface VisualNeedDecision {
  needed: boolean;
  reason: "question_requests_figure_measurement" | "unresolved_quantitative_gap" | "no_visual_signal" | "no_unresolved_gap" | "no_full_text_evidence";
  signals: string[];
}

export function decideVisualEvidenceNeed(input: VisualNeedInput): VisualNeedDecision {
  const haystack = [input.questionText, ...(input.completionCriteria ?? [])].join(" ").toLowerCase();
  const visualSignals = EXPLICIT_VISUAL_SIGNALS.filter((signal) => haystack.includes(signal));
  const quantitativeSignals = QUANTITATIVE_SIGNALS.filter((signal) => haystack.includes(signal));
  const signals = [...new Set([...visualSignals, ...quantitativeSignals])];
  if (visualSignals.length === 0 && quantitativeSignals.length === 0) {
    return { needed: false, reason: "no_visual_signal", signals: [] };
  }
  if (input.fullTextEvidenceCount === 0) return { needed: false, reason: "no_full_text_evidence", signals };
  if (visualSignals.length > 0 && quantitativeSignals.length > 0) {
    return { needed: true, reason: "question_requests_figure_measurement", signals };
  }
  if (input.status === "resolved") return { needed: false, reason: "no_unresolved_gap", signals };
  return { needed: true, reason: "unresolved_quantitative_gap", signals };
}

// ─── Structured output normalization ────────────────────────────────────────

export interface NormalizedVisualObservation {
  statement: string;
  resourceId: string;
  pageNo?: number;
  figureNo?: number;
  tableNo?: number;
  metric?: string;
  value?: string;
  unit?: string;
  confidence: number;
  limitations?: string;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maximum);
}

function boundedInt(value: unknown, minimum: number, maximum: number): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const integer = Math.trunc(numeric);
  if (integer < minimum || integer > maximum) return undefined;
  return integer;
}

/**
 * 严格归一化 `{observations:[...]}`。未知 resourceId、非有限 confidence、
 * 缺失 statement 的条目一律丢弃；输出永远不是模型原始 Markdown。
 */
export function normalizeVisualObservationOutput(
  value: unknown,
  allowedResourceIds: ReadonlySet<string>,
): { observations: NormalizedVisualObservation[]; rejected: number } {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const raw = Array.isArray(record.observations) ? record.observations : [];
  const observations: NormalizedVisualObservation[] = [];
  let rejected = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      rejected += 1;
      continue;
    }
    const item = entry as Record<string, unknown>;
    const statement = boundedString(item.statement, STATEMENT_MAX_CHARS);
    const resourceId = boundedString(item.resourceId, SHORT_FIELD_MAX_CHARS);
    const confidence = typeof item.confidence === "number" && Number.isFinite(item.confidence)
      ? Math.max(0, Math.min(1, item.confidence))
      : null;
    if (!statement || !resourceId || !allowedResourceIds.has(resourceId) || confidence === null) {
      rejected += 1;
      continue;
    }
    observations.push({
      statement,
      resourceId,
      confidence,
      ...(boundedInt(item.pageNo, 1, 100_000) !== undefined ? { pageNo: boundedInt(item.pageNo, 1, 100_000)! } : {}),
      ...(boundedInt(item.figureNo, 1, 10_000) !== undefined ? { figureNo: boundedInt(item.figureNo, 1, 10_000)! } : {}),
      ...(boundedInt(item.tableNo, 1, 10_000) !== undefined ? { tableNo: boundedInt(item.tableNo, 1, 10_000)! } : {}),
      ...(boundedString(item.metric, SHORT_FIELD_MAX_CHARS) ? { metric: boundedString(item.metric, SHORT_FIELD_MAX_CHARS)! } : {}),
      ...(boundedString(item.value, SHORT_FIELD_MAX_CHARS) ? { value: boundedString(item.value, SHORT_FIELD_MAX_CHARS)! } : {}),
      ...(boundedString(item.unit, SHORT_FIELD_MAX_CHARS) ? { unit: boundedString(item.unit, SHORT_FIELD_MAX_CHARS)! } : {}),
      ...(boundedString(item.limitations, SHORT_FIELD_MAX_CHARS) ? { limitations: boundedString(item.limitations, SHORT_FIELD_MAX_CHARS)! } : {}),
    });
    if (observations.length >= VISUAL_EVIDENCE_MAX_OBSERVATIONS) break;
  }
  return { observations, rejected };
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export interface VisualAnalysisResourceInput {
  /** 传给模型的稳定标识（`r1`、`r2`…），不是上游文件名。 */
  resourceId: string;
  kind: "figure" | "table" | "image";
  alt?: string;
  caption?: string;
  pageNo?: number;
}

export function buildVisualEvidencePrompt(input: {
  question: string;
  resources: VisualAnalysisResourceInput[];
  bodyContext: string;
}): string {
  return [
    "你是 LumenLab Research Visual Evaluator。只返回 JSON，不要 Markdown，不要隐藏推理，不要联网。",
    "你只会看到明确选中的论文图表资源；不要引用未提供的图片，也不要推测图片之外的结论。",
    "格式：{\"observations\":[{\"statement\":\"图表直接支持的观察\",\"resourceId\":\"r1\",\"pageNo\":1,\"figureNo\":2,\"metric\":\"准确率\",\"value\":\"87.3\",\"unit\":\"%\",\"confidence\":0.0到1.0,\"limitations\":\"读数限制\"}]}。",
    "只记录能从图像本身读出的定量或结构性观察；无法确定时降低 confidence 并写明 limitations；没有可读内容时返回 {\"observations\":[]}。",
    "禁止把图表里的数字外推成论文正文没有的结论，也禁止把多个资源混为一条观察。",
    `研究问题：${input.question}`,
    `已选中资源：${JSON.stringify(input.resources.map((resource) => ({ resourceId: resource.resourceId, kind: resource.kind, alt: resource.alt ?? null, caption: resource.caption ?? null, pageNo: resource.pageNo ?? null })))}`,
    `正文上下文（有界，仅用于判断图表含义）：${input.bodyContext.slice(0, CAPTION_MAX_CHARS * 4)}`,
  ].join("\n");
}

// ─── Persistence ────────────────────────────────────────────────────────────

export interface VisualResourceForPersistence {
  resourceId: string;
  fileName: string;
  kind: "figure" | "table" | "image";
  mimeType: string;
  bytes: Buffer;
  alt?: string;
  caption?: string;
  pageNo?: number;
}

/**
 * 从图注/alt 文本里确定性提取编号（模型没给编号时的兜底），例如
 * "Figure 3: throughput" → 3，"表 2 对比结果" → 2。
 */
function extractLocatorNumber(text: string | undefined, kind: "figure" | "table" | "image"): number | undefined {
  if (!text) return undefined;
  const pattern = kind === "table" ? /(?:table|表)\s*(\d{1,3})/i : /(?:fig(?:ure)?\.?|图)\s*(\d{1,3})/i;
  const match = pattern.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 1 && value <= 10_000 ? value : undefined;
}

function captionHash(input: { alt?: string; caption?: string; fileName: string }): string {
  return createHash("sha256")
    .update([input.fileName, input.alt ?? "", input.caption ?? ""].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
}

export interface PersistedVisualObservation {
  evidenceId: string;
  resourceId: string;
}

/**
 * 把视觉观察持久化为 Evidence。对象存储失败只降级 `rawContentPersisted`，
 * 观察与 provenance 仍落库（与正文 Evidence 的降级策略一致）。
 * 幂等由 (runId, evidenceKey) 保证：同一 snapshot + 同一 resource locator +
 * 同一 statement 在 task 重跑时得到同一行。
 */
export async function persistVisualObservations(input: {
  userId: string;
  workspaceId: string;
  runId: string;
  questionId: string;
  sourceSnapshotId: string;
  canonicalKey: string;
  snapshotContentHash: string;
  analysisModel: string;
  analysisStageVersion?: string;
  resources: VisualResourceForPersistence[];
  observations: NormalizedVisualObservation[];
}): Promise<PersistedVisualObservation[]> {
  const resourceById = new Map(input.resources.map((resource) => [resource.resourceId, resource]));
  const persistedResources = new Map<string, { provider: string; key: string } | null>();
  for (const resource of input.resources) {
    let location: { provider: string; key: string } | null = null;
    try {
      location = await uploadObjectBuffer({
        key: `research/${input.userId}/${input.runId}/resources/${captionHash({ alt: resource.alt, caption: resource.caption, fileName: resource.fileName })}.${resource.mimeType.includes("png") ? "png" : "img"}`,
        mimeType: resource.mimeType,
        buffer: resource.bytes,
      });
    } catch (error) {
      console.error("[research] visual resource upload failed; persisting observation with bounded provenance only", {
        runId: input.runId,
        resourceId: resource.resourceId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    persistedResources.set(resource.resourceId, location);
  }

  const persisted: PersistedVisualObservation[] = [];
  for (const observation of input.observations) {
    const resource = resourceById.get(observation.resourceId);
    if (!resource) continue;
    const hash = captionHash({ alt: resource.alt, caption: resource.caption, fileName: resource.fileName });
    // 页码优先用模型读数，其次用检索命中的页码；编号优先用模型读数，其次从
    // 图注/alt 文本确定性提取。绝不臆造定位。
    const pageNo = observation.pageNo ?? resource.pageNo;
    const figureNo = observation.figureNo ?? (resource.kind === "figure" ? extractLocatorNumber(resource.caption ?? resource.alt, "figure") : undefined);
    const tableNo = observation.tableNo ?? (resource.kind === "table" ? extractLocatorNumber(resource.caption ?? resource.alt, "table") : undefined);
    const locator = {
      kind: "sciverse_resource" as const,
      docId: resource.fileName,
      resourceId: resource.resourceId,
      resourceKind: resource.kind,
      ...(pageNo !== undefined ? { pageNo } : {}),
      ...(figureNo !== undefined ? { figureNo } : {}),
      ...(tableNo !== undefined ? { tableNo } : {}),
      captionHash: hash,
    };
    const excerpt = [
      observation.statement,
      observation.metric || observation.value
        ? `（${[observation.metric, observation.value, observation.unit].filter(Boolean).join(" ")}）`
        : "",
      observation.limitations ? `限制：${observation.limitations}` : "",
    ].join("").slice(0, STATEMENT_MAX_CHARS * 2);
    const evidenceKey = buildResearchEvidenceKey({
      canonicalKey: input.canonicalKey,
      contentHash: input.snapshotContentHash,
      locator,
      excerpt,
      evidenceType: "visual_observation",
    });
    const location = persistedResources.get(observation.resourceId) ?? null;
    const provenance = {
      modality: "visual",
      provider: "sciverse",
      resourceId: observation.resourceId,
      resourceKind: resource.kind,
      resourceFileName: resource.fileName,
      resourceLocator: {
        pageNo: pageNo ?? null,
        figureNo: figureNo ?? null,
        tableNo: tableNo ?? null,
        captionHash: hash,
      },
      captionPreview: (resource.caption ?? resource.alt ?? "").slice(0, CAPTION_MAX_CHARS) || null,
      analysisModel: input.analysisModel,
      analysisStageVersion: input.analysisStageVersion ?? VISUAL_EVIDENCE_STAGE_VERSION,
      confidence: observation.confidence,
      metric: observation.metric ?? null,
      value: observation.value ?? null,
      unit: observation.unit ?? null,
      limitations: observation.limitations ?? null,
      sourceSnapshotId: input.sourceSnapshotId,
      sourceSnapshotContentHash: input.snapshotContentHash,
      rawContentPersisted: location !== null,
      resource: location
        ? { provider: location.provider, key: location.key, mimeType: resource.mimeType, byteLength: resource.bytes.length }
        : { provider: null, key: null, mimeType: resource.mimeType, byteLength: resource.bytes.length },
    };
    const evidence = await prisma.evidence.upsert({
      where: { runId_evidenceKey: { runId: input.runId, evidenceKey } },
      create: {
        workspaceId: input.workspaceId,
        runId: input.runId,
        questionId: input.questionId,
        sourceSnapshotId: input.sourceSnapshotId,
        statement: observation.statement,
        locator,
        excerpt,
        evidenceType: "visual_observation",
        evidenceKey,
        provenance,
      },
      update: {},
    });
    persisted.push({ evidenceId: evidence.id, resourceId: observation.resourceId });
  }
  return persisted;
}

/** Question 级 idempotency fingerprint：已分析资源 + 已有全文证据集合。 */
export function buildVisualEvidenceFingerprint(input: {
  evidenceIds: readonly string[];
  status: string;
}): string {
  return createHash("sha256")
    .update([input.status, ...[...input.evidenceIds].sort()].join("\u0000"))
    .digest("hex")
    .slice(0, 32);
}
