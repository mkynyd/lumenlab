import { createHash } from "node:crypto";

/**
 * Deep Research Claim Graph v1 — Claim Extractor 结构化阶段的纯函数层。
 * 本模块不访问数据库、不联网；输入是当前 Run 已持久化的 bounded Evidence，
 * 输出是经过严格 normalize 的原子 Claim 与 Evidence 关系。
 */

export const CLAIM_EXTRACTOR_VERSION = "cex1";
export const MAX_CLAIMS_PER_QUESTION = 6;
const MAX_STATEMENT_LENGTH = 600;
const MAX_QUALIFIERS = 6;
const MAX_QUALIFIER_LENGTH = 240;
const MAX_RATIONALE_LENGTH = 400;
const MAX_KEY_LENGTH = 48;

export const CLAIM_RELATION_TYPES = ["supports", "contradicts", "qualifies", "context"] as const;
export type ClaimRelationType = (typeof CLAIM_RELATION_TYPES)[number];

export interface NormalizedClaimRelation {
  evidenceId: string;
  relation: ClaimRelationType;
  confidence: number;
  rationale: string | null;
}

export interface NormalizedExtractedClaim {
  key: string;
  statement: string;
  qualifiers: string[];
  relations: NormalizedClaimRelation[];
}

export interface ClaimExtractorDecision {
  claims: NormalizedExtractedClaim[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 一个 Question 当前 active Evidence 集合的 deterministic fingerprint。
 * 只依赖 Evidence ID 与 status：集合不变则 durable 重跑不会重复调用 Extractor；
 * 集合变化（新增/失效）时只重算受影响的 Question。
 */
export function buildQuestionEvidenceFingerprint(evidences: Array<{ id: string; status: string }>): string {
  const stable = evidences.map((evidence) => `${evidence.id}:${evidence.status}`).sort();
  return sha256(stable.join("\n"));
}

/**
 * 把模型给的语义 key 归一化为短小稳定的 slug；缺失或非法时退到 statement hash，
 * 绝不直接使用自由文本标题或数据库序号。
 */
export function normalizeClaimSemanticKey(raw: unknown, statement: string): string {
  if (typeof raw === "string") {
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_KEY_LENGTH)
      .replace(/-+$/g, "");
    if (slug.length >= 2) return slug;
  }
  return `c-${sha256(statement).slice(0, 12)}`;
}

/** system Claim 的 deterministic 幂等键：extractor 版本 + Question key + 语义 key。 */
export function buildClaimKey(questionKey: string, semanticKey: string): string {
  return `${CLAIM_EXTRACTOR_VERSION}:${questionKey}:${semanticKey}`;
}

function isClaimRelationType(value: unknown): value is ClaimRelationType {
  return value === "supports" || value === "contradicts" || value === "qualifies" || value === "context";
}

/**
 * 不信任模型输出的 normalize：
 * - 只保留输入中真实存在的 Evidence ID；
 * - 非法 relation、非有限 confidence、空 statement、重复 relation、超长字段一律丢弃或截断；
 * - 最多 MAX_CLAIMS_PER_QUESTION 个原子 Claim；没有足够证据时允许空数组。
 */
export function normalizeClaimExtractorOutput(value: unknown, validEvidenceIds: ReadonlySet<string>): ClaimExtractorDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawClaims = Array.isArray(record.claims) ? record.claims : [];
  const claims: NormalizedExtractedClaim[] = [];
  const seenKeys = new Set<string>();
  for (const raw of rawClaims) {
    if (claims.length >= MAX_CLAIMS_PER_QUESTION) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const statement = typeof item.statement === "string" ? item.statement.replace(/\s+/g, " ").trim().slice(0, MAX_STATEMENT_LENGTH) : "";
    if (!statement) continue;
    const key = normalizeClaimSemanticKey(item.key, statement);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const qualifiers = Array.isArray(item.qualifiers)
      ? item.qualifiers
          .filter((qualifier): qualifier is string => typeof qualifier === "string" && qualifier.trim().length > 0)
          .map((qualifier) => qualifier.replace(/\s+/g, " ").trim().slice(0, MAX_QUALIFIER_LENGTH))
          .slice(0, MAX_QUALIFIERS)
      : [];
    const relations: NormalizedClaimRelation[] = [];
    const seenEvidence = new Set<string>();
    const rawRelations = Array.isArray(item.relations) ? item.relations : [];
    for (const rawRelation of rawRelations) {
      if (!rawRelation || typeof rawRelation !== "object" || Array.isArray(rawRelation)) continue;
      const relation = rawRelation as Record<string, unknown>;
      const evidenceId = typeof relation.evidenceId === "string" ? relation.evidenceId : null;
      if (!evidenceId || !validEvidenceIds.has(evidenceId) || seenEvidence.has(evidenceId)) continue;
      if (!isClaimRelationType(relation.relation)) continue;
      const confidence = typeof relation.confidence === "number" && Number.isFinite(relation.confidence)
        ? Math.max(0, Math.min(1, relation.confidence))
        : null;
      if (confidence === null) continue;
      seenEvidence.add(evidenceId);
      relations.push({
        evidenceId,
        relation: relation.relation,
        confidence,
        rationale: typeof relation.rationale === "string" && relation.rationale.trim().length > 0
          ? relation.rationale.replace(/\s+/g, " ").trim().slice(0, MAX_RATIONALE_LENGTH)
          : null,
      });
    }
    claims.push({ key, statement, qualifiers, relations });
  }
  return { claims };
}

export interface ClaimExtractionEvidencePromptItem {
  id: string;
  statement: string;
  excerpt: string;
  evidenceType: string;
  locator: unknown;
  provenance: unknown;
  source: {
    canonicalKey: string;
    title: string | null;
    kind: string;
    provider: string | null;
    doi: string | null;
    canonicalUrl: string | null;
  };
}

/** Claim Extractor 的 prompt：无联网、无通用项目上下文，只消费当前 Question 的 bounded Evidence。 */
export function buildClaimExtractionPrompt(input: {
  question: { key: string; title: string; question: string; completionCriteria: unknown };
  domainProfile?: unknown;
  evidence: ClaimExtractionEvidencePromptItem[];
}): string {
  const evidenceText = input.evidence.map((item) => JSON.stringify({
    evidenceId: item.id,
    statement: item.statement,
    excerpt: item.excerpt.slice(0, 1_200),
    evidenceType: item.evidenceType,
    locator: item.locator,
    source: item.source,
  })).join("\n");
  return [
    "你是 LumenLab Research Claim Extractor。只返回 JSON，不要 Markdown，不要隐藏推理，不要联网，不要补充任何未提供的资料。",
    "任务：从给定 Evidence 中提炼 0 到 6 个原子 Claim。一个 Claim 是单一、可检验的事实命题，不是一个段落或多个命题的合取。",
    "证据不足时返回空 claims 数组，绝不能为了产出结果捏造 Claim；Claim statement 不得超出 Evidence 实际表达的范围、时间与因果强度。",
    "只能引用下面真实存在的 evidenceId；每条 relation 的 relation 语义：supports=该证据直接或明显支持 Claim；contradicts=该证据与 Claim 实质冲突；qualifies=该证据要求缩小 Claim 的范围/时间/条件/程度；context=仅提供背景，不能单独支撑 Claim。confidence 为 0 到 1 的有限数值，rationale 用一句话说明。",
    "key 必须是短小稳定的英文语义 slug（小写字母/数字/连字符，如 self-attention-removes-recurrence），不要写自由文本标题。",
    "JSON 格式：{\"claims\":[{\"key\":\"...\",\"statement\":\"...\",\"qualifiers\":[\"可选限定\"],\"relations\":[{\"evidenceId\":\"...\",\"relation\":\"supports|contradicts|qualifies|context\",\"confidence\":0.0,\"rationale\":\"...\"}]}]}",
    `Research Question（${input.question.key}）：${input.question.question}`,
    `标题：${input.question.title}`,
    `完成标准：${JSON.stringify(input.question.completionCriteria ?? [])}`,
    `领域 Profile：${JSON.stringify(input.domainProfile ?? {})}`,
    "本 Question 的 Evidence：",
    evidenceText || "（本 Question 没有可用 Evidence，应返回空 claims）",
  ].join("\n");
}
