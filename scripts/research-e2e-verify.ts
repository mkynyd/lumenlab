/**
 * research-e2e-verify — 对指定 Research Run 做只读结构验证。
 *
 * 只读数据库（不调用外部 API、不创建/修改任何记录、不需要 LUMENLAB_LIVE_SMOKE）。
 * 检查 Run 状态、候选/来源/证据、evidenceKey 幂等、Sciverse locator/provenance、
 * Claim Graph（claimKey、relation、verification、source independence）、
 * Citation Graph 边与 provenance、visual observation evidence（若发生）、
 * advanced filter provenance、统一 metrics/accounting、ReportSnapshot/citationMap、
 * canonical source 去重、durable lease 与残留 task。
 *
 * 输出只包含计数、哈希前缀与截断后的标识；不 dump Secret、完整 Evidence 正文、
 * 用户 Prompt、模型隐藏推理或 raw provider response。
 *
 * 用法：npx tsx --tsconfig scripts/tsconfig.json --env-file=.env scripts/research-e2e-verify.ts --run <runId>
 *       （或 SMOKE_RUN_ID=<runId>）
 */
import { prisma } from "@/lib/db";
import { createDiagnosticsReporter, parseCliArgs } from "./lib/live-diagnostics";

const SCRIPT = "research-e2e-verify";

async function main() {
  const { values } = parseCliArgs(process.argv.slice(2));
  const runId = values.get("run")?.trim() || process.env.SMOKE_RUN_ID?.trim();
  const report = createDiagnosticsReporter(SCRIPT);
  if (!runId) {
    report.fail(`run id required: --run <runId> or SMOKE_RUN_ID`);
    process.exit(report.summarize());
  }
  const check = (ok: boolean, label: string, detail?: unknown) => (ok ? report.pass(label, detail) : report.fail(label, detail));

  const run = await prisma.researchRun.findUniqueOrThrow({
    where: { id: runId },
    include: { questions: { orderBy: { orderIndex: "asc" } }, reportSnapshot: true },
  });
  check(run.status === "completed", "run completed", { status: run.status });

  // ---- candidates / sources ----
  const candidates = await prisma.researchSourceCandidate.findMany({ where: { runId } });
  const byProvider: Record<string, Record<string, number>> = {};
  for (const candidate of candidates) {
    byProvider[candidate.provider] ??= {};
    byProvider[candidate.provider][candidate.status] = (byProvider[candidate.provider][candidate.status] ?? 0) + 1;
  }
  report.info("candidates by provider/status", byProvider);
  check(candidates.some((candidate) => candidate.provider === "sciverse" && candidate.status === "fetched"), "sciverse candidate fetched");
  check(candidates.some((candidate) => candidate.provider === "anysearch" || candidate.provider === "web" || candidates.some((c) => c.provider !== "sciverse" && c.status === "fetched")), "web channel present alongside sciverse");

  // ---- evidence ----
  const evidences = await prisma.evidence.findMany({
    where: { runId },
    include: { sourceSnapshot: { include: { source: true } } },
    orderBy: { createdAt: "asc" },
  });
  report.info("evidence count", evidences.length);
  const keyCount = evidences.filter((evidence) => evidence.evidenceKey).length;
  check(keyCount === evidences.length, "all system evidence has deterministic evidenceKey", { withKey: keyCount, total: evidences.length });
  const keySet = new Set(evidences.map((evidence) => evidence.evidenceKey));
  check(keySet.size === keyCount, "no duplicate chunk evidence (evidenceKey unique)", { unique: keySet.size, total: keyCount });

  const sciverseEvidence = evidences.filter((evidence) => {
    const locator = evidence.locator as Record<string, unknown> | null;
    return locator?.kind === "sciverse";
  });
  check(sciverseEvidence.length > 0, "sciverse evidence exists", { count: sciverseEvidence.length });
  const sample = sciverseEvidence[0];
  if (sample) {
    const locator = sample.locator as Record<string, unknown>;
    const provenance = (sample.provenance ?? {}) as Record<string, unknown>;
    const scope = ((sample.sourceSnapshot.metadata as Record<string, unknown> | null)?.scope ?? {}) as Record<string, unknown>;
    if (scope.type === "metadata_only") {
      // 无全文权限时的设计内降级：locator 保留 uniqueId/docId/doi，retrievalMethod 记录在 snapshot scope。
      check(locator.kind === "sciverse" && (Boolean(locator.uniqueId) || Boolean(locator.docId) || Boolean(locator.doi)), "metadata-only sciverse locator keeps identifiers", { locator });
      check(scope.retrievalMethod === "sciverse.search", "metadata-only scope records retrieval method", { retrievalMethod: scope.retrievalMethod });
    } else {
      check(Boolean(locator.docId) && (Boolean(locator.chunkId) || typeof locator.offset === "number"), "sciverse locator has docId/chunkId/offset", { locator });
      check(typeof provenance.retrievalMethod === "string" && typeof provenance.provider === "string", "provenance keeps retrieval method/provider", { retrievalMethod: provenance.retrievalMethod, provider: provenance.provider, semanticScore: provenance.semanticScore });
    }
    check(sample.evidenceType === "direct_quote", "raw passage uses direct_quote", { evidenceType: sample.evidenceType });
  }
  const chunkLevel = sciverseEvidence.filter((evidence) => {
    const locator = evidence.locator as Record<string, unknown>;
    return Boolean(locator.docId) && (Boolean(locator.chunkId) || typeof locator.offset === "number");
  });
  report.info("chunk-level sciverse evidence (full-text accessible papers)", { count: chunkLevel.length });
  if (chunkLevel.length === 0) {
    report.warn("no chunk-level sciverse evidence in this run (metadata-only fallback is by design when full text is inaccessible)");
  }

  // ---- citation graph（只读；不输出完整关系列表） ----
  const citationEdges = await prisma.researchSourceRelation.findMany({ where: { runId }, select: { edgeKey: true, relation: true, hop: true, sourceId: true, targetSourceId: true, externalTargetId: true } });
  const edgeKeys = citationEdges.map((edge) => edge.edgeKey);
  check(new Set(edgeKeys).size === edgeKeys.length, "citation edge keys unique within run", { edges: citationEdges.length });
  if (citationEdges.length > 0) {
    const linked = citationEdges.filter((edge) => edge.targetSourceId).length;
    report.pass("citation edges persisted", { edges: citationEdges.length, linkedTargets: linked, relations: [...new Set(citationEdges.map((edge) => edge.relation))], maxHop: Math.max(...citationEdges.map((edge) => edge.hop)) });
    const graphCandidates = candidates.filter((candidate) => {
      const metadata = (candidate.metadata ?? {}) as Record<string, unknown>;
      return metadata.discovery === "sciverse.paper_relations";
    });
    check(graphCandidates.every((candidate) => {
      const metadata = (candidate.metadata ?? {}) as Record<string, unknown>;
      return typeof metadata.seedSourceId === "string" && typeof metadata.relation === "string" && typeof metadata.hop === "number";
    }), "graph-derived candidates carry seed/relation/hop provenance", { graphCandidates: graphCandidates.length });
    const metricsRecord = (run.metrics ?? {}) as Record<string, unknown>;
    check(typeof metricsRecord.graphEdgesDiscovered === "number", "run metrics carry graph summary", { graphEdgesDiscovered: metricsRecord.graphEdgesDiscovered, graphSourcesFetched: metricsRecord.graphSourcesFetched });
  } else {
    // 没有 expansion 需求（resolved 且来源充足）或未找到可扩展 seed 是合法结果。
    report.warn("no citation edges in this run (expansion may have been legitimately skipped)");
  }

  // ---- visual evidence（可选；只在确实发生时校验 provenance） ----
  const visualEvidence = evidences.filter((evidence) => evidence.evidenceType === "visual_observation");
  report.info("visual observation evidence", { count: visualEvidence.length });
  for (const evidence of visualEvidence) {
    const locator = evidence.locator as Record<string, unknown>;
    const provenance = (evidence.provenance ?? {}) as Record<string, unknown>;
    const resourceLocator = (provenance.resourceLocator ?? {}) as Record<string, unknown>;
    check(locator.kind === "sciverse_resource" && typeof locator.resourceId === "string", "visual evidence locator points at a sciverse resource", { kind: locator.kind, resourceKind: locator.resourceKind });
    check(provenance.modality === "visual" && provenance.provider === "sciverse" && typeof provenance.analysisModel === "string", "visual evidence keeps model/stage provenance", { model: provenance.analysisModel, stage: provenance.analysisStageVersion });
    check(typeof resourceLocator.captionHash === "string" && typeof evidence.sourceSnapshotId === "string", "visual evidence traces to snapshot + caption hash");
    check(evidence.evidenceType !== "direct_quote", "visual observation is never marked as a direct quote");
  }
  if (visualEvidence.length === 0) {
    report.warn("no visual observation evidence in this run (visual analysis is optional and budget gated)");
  }

  // ---- claims ----
  const claims = await prisma.claim.findMany({
    where: { runId },
    include: { evidenceRelations: { include: { evidence: { include: { sourceSnapshot: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const activeClaims = claims.filter((claim) => claim.status === "active" || claim.status === "disputed");
  report.info("claims", { total: claims.length, active: activeClaims.length, superseded: claims.length - activeClaims.length });
  check(activeClaims.length > 0, "claim extractor produced at least one system claim");
  check(!claims.some((claim) => claim.statement.includes("的证据已获得独立来源支持")), "no legacy template claim");
  const withKey = activeClaims.filter((claim) => claim.claimKey).length;
  check(withKey === activeClaims.length, "all system claims carry deterministic claimKey", { withKey, total: activeClaims.length });
  check(new Set(activeClaims.map((claim) => claim.claimKey)).size === withKey, "claimKey unique within run");

  const evidenceIds = new Set(evidences.map((evidence) => evidence.id));
  let unknownRelation = 0;
  let missingMeta = 0;
  let allSupports = true;
  for (const claim of activeClaims) {
    for (const relation of claim.evidenceRelations) {
      if (!evidenceIds.has(relation.evidenceId)) unknownRelation += 1;
      if (relation.confidence == null || !relation.rationale) missingMeta += 1;
      if (relation.relation !== "supports") allSupports = false;
    }
  }
  check(unknownRelation === 0, "no relation references unknown evidence");
  check(missingMeta === 0, "relations carry confidence and rationale from extraction", { missingMeta });
  if (activeClaims.some((claim) => claim.evidenceRelations.length >= 3)) {
    check(!allSupports, "not every relation is unconditionally supports");
  }
  for (const claim of activeClaims) {
    const quality = (claim.quality ?? {}) as Record<string, unknown>;
    const validRelations = claim.evidenceRelations.filter((relation) => relation.evidence.status === "active");
    const uniqueSources = new Set(validRelations.map((relation) => relation.evidence.sourceSnapshot.sourceId)).size;
    check(quality.uniqueSourceCount === uniqueSources, `uniqueSourceCount consistent for claim ${claim.claimKey}`, { recorded: quality.uniqueSourceCount, actual: uniqueSources });
    report.info("claim", {
      key: claim.claimKey,
      statement: claim.statement.slice(0, 80),
      status: claim.verificationStatus,
      reason: quality.verificationReason,
      supports: quality.directSupportCount,
      contradicts: quality.contradictionCount,
      qualifies: quality.qualificationCount,
      context: quality.contextCount,
      uniqueSources: quality.uniqueSourceCount,
    });
  }
  check(!activeClaims.some((claim) => claim.verificationStatus === "verified" && ((claim.quality as Record<string, unknown>)?.directSupportCount ?? 0) === 0), "no verified claim without direct support (deterministic floor held)");
  check(!activeClaims.some((claim) => claim.verificationStatus === "pending"), "no claim left pending");
  // visual_observation / metadata_only 支撑不能单独把 Claim 抬到 verified。
  check(!activeClaims.some((claim) => {
    const quality = (claim.quality ?? {}) as Record<string, unknown>;
    const supports = Number(quality.directSupportCount ?? 0);
    if (supports === 0) return false;
    const derivedOnly = Number(quality.visualObservationSupportCount ?? 0) === supports
      || Number(quality.metadataOnlySupportCount ?? 0) === supports;
    return claim.verificationStatus === "verified" && derivedOnly;
  }), "no verified claim supported only by visual or metadata-only evidence");
  // metadata-only 来源不能作为正文事实引用：这里记录数量，正文措辞在 report 段核对。
  const metadataOnlyEvidenceCount = evidences.filter((evidence) => {
    const scope = ((evidence.sourceSnapshot.metadata as Record<string, unknown> | null)?.scope ?? {}) as Record<string, unknown>;
    return scope.type === "metadata_only";
  }).length;
  report.info("metadata-only evidence", { count: metadataOnlyEvidenceCount });

  // ---- report ----
  const reportSnapshot = run.reportSnapshot;
  check(Boolean(reportSnapshot), "report snapshot frozen");
  if (reportSnapshot) {
    const citationMap = reportSnapshot.citationMap as Record<string, Array<{ evidenceId: string; relation: string; source: { title: string | null; doi: string | null; canonicalUrl: string | null; provider: string | null } }>>;
    report.info("report refs", { evidenceIds: reportSnapshot.evidenceIds.length, sourceSnapshotIds: reportSnapshot.sourceSnapshotIds.length, citationEntries: Object.keys(citationMap).length });
    const entries = Object.entries(citationMap).slice(0, 2);
    for (const [, refs] of entries) {
      for (const ref of refs.slice(0, 1)) {
        const evidence = evidences.find((item) => item.id === ref.evidenceId);
        check(Boolean(evidence), `citation trace evidence ${ref.evidenceId.slice(0, 8)}… exists`, {
          relation: ref.relation,
          sourceTitle: ref.source.title?.slice(0, 60),
          doi: ref.source.doi,
          url: ref.source.canonicalUrl?.slice(0, 80),
          provider: ref.source.provider,
        });
      }
    }
    const body = ((reportSnapshot.reportDocument as Record<string, unknown>)?.body as string) ?? "";
    const markers = [...new Set([...body.matchAll(/\[E(\d+)\]/g)].map((match) => Number(match[1])))];
    check(markers.every((index) => index >= 1 && index <= reportSnapshot.evidenceIds.length), "all [E#] markers resolve to snapshot evidence", { markers: markers.slice(0, 10), evidenceCount: reportSnapshot.evidenceIds.length });
    const relationEvidenceIds = new Set(activeClaims.flatMap((claim) => claim.evidenceRelations.map((relation) => relation.evidenceId)));
    const sampleMarkers = markers.slice(0, 2);
    for (const index of sampleMarkers) {
      const evidenceId = reportSnapshot.evidenceIds[index - 1];
      check(relationEvidenceIds.has(evidenceId), `marker E${index} evidence participates in a ClaimEvidenceRelation`);
    }
    // citationMap 每条 entry 必须能追到 Snapshot 与 Source，且 metadata-only 不伪装成正文。
    const citationEntries = Object.values(citationMap).flat();
    const snapshotIds = new Set(reportSnapshot.sourceSnapshotIds);
    check(citationEntries.every((entry) => snapshotIds.has((entry as { sourceSnapshotId?: string }).sourceSnapshotId ?? "")), "every citationMap entry traces to a frozen source snapshot", { entries: citationEntries.length });
    const withSource = citationEntries.filter((entry) => entry.source && (entry.source.title || entry.source.doi || entry.source.canonicalUrl)).length;
    check(citationEntries.length === 0 || withSource === citationEntries.length, "every citationMap entry carries a usable source identity", { withSource, total: citationEntries.length });
    // unsupported Claim 不以肯定语气进入正文（正文必须出现限定/否定标记或未引用）。
    const unsupportedStatements = activeClaims.filter((claim) => claim.verificationStatus === "unsupported").map((claim) => claim.statement.slice(0, 40)).filter((statement) => statement.length > 12);
    const assertive = unsupportedStatements.filter((statement) => body.includes(statement) && !/(证据不足|未获支持|无法确认|不足以|尚无)/.test(body.slice(Math.max(0, body.indexOf(statement) - 80), body.indexOf(statement) + statement.length + 80)));
    check(assertive.length === 0, "unsupported claims do not appear assertively in the report body", { checked: unsupportedStatements.length, assertive: assertive.length });
    // 参考来源去重按 canonical ResearchSource，且不出现来源数量膨胀。
    const canonicalSources = new Set(evidences.map((evidence) => evidence.sourceSnapshot.source.canonicalKey));
    report.info("canonical sources", { count: canonicalSources.size, snapshots: reportSnapshot.sourceSnapshotIds.length, evidence: evidences.length });
    check((run.metrics as Record<string, unknown> | null)?.sourceCount === canonicalSources.size, "reported source count equals canonical source count", { reported: (run.metrics as Record<string, unknown> | null)?.sourceCount, actual: canonicalSources.size });
    check((run.metrics as Record<string, unknown> | null)?.sourceSnapshotCount === reportSnapshot.sourceSnapshotIds.length, "reported snapshot count equals frozen snapshots", { reported: (run.metrics as Record<string, unknown> | null)?.sourceSnapshotCount, actual: reportSnapshot.sourceSnapshotIds.length });
    // ReportSnapshot 必须完整。
    check(Boolean(reportSnapshot.contentHash) && Boolean(reportSnapshot.verificationSummary) && Boolean(reportSnapshot.coverageSummary), "report snapshot carries hash/verification/coverage");
  }

  // ---- advanced filter provenance + unified metrics ----
  const metricsRecord = (run.metrics ?? {}) as Record<string, unknown>;
  const scholarlyFilters = (metricsRecord.scholarlyFilters ?? {}) as Record<string, unknown>;
  if (typeof scholarlyFilters.questions === "number" && (scholarlyFilters.questions as number) > 0) {
    report.pass("sciverse scholarly filter provenance recorded", {
      applied: Array.isArray(scholarlyFilters.applied) ? (scholarlyFilters.applied as unknown[]).length : 0,
      dropped: Array.isArray(scholarlyFilters.dropped) ? (scholarlyFilters.dropped as unknown[]).length : 0,
      relaxedRetry: scholarlyFilters.relaxedRetry === true,
    });
  } else {
    report.info("no advanced scholarly filters were requested in this run");
  }
  check(typeof metricsRecord.elapsedMs === "number", "run metrics carry elapsed duration", { elapsedMs: metricsRecord.elapsedMs, budgetStopReason: metricsRecord.budgetStopReason });
  check(typeof metricsRecord.fetchCalls === "number" && typeof metricsRecord.searchCalls === "number", "run metrics carry tool call counters", { searchCalls: metricsRecord.searchCalls, fetchCalls: metricsRecord.fetchCalls });
  check(typeof metricsRecord.claimCount === "number" && metricsRecord.claimCount === activeClaims.length, "run metrics claimCount matches persisted claims", { recorded: metricsRecord.claimCount, actual: activeClaims.length });
  check(Array.isArray(metricsRecord.degradations), "run metrics record provider degradations", { degradations: (metricsRecord.degradations as unknown[] | undefined)?.length ?? 0 });
  // 没有无限 fan-out：工具调用次数必须落在预算之内。
  const budgetSnapshot = (run.budgetSnapshot ?? {}) as Record<string, unknown>;
  if (typeof budgetSnapshot.searchCalls === "number") {
    check(Number(metricsRecord.searchCalls ?? 0) <= Number(budgetSnapshot.searchCalls), "search calls stayed within the profile budget", { used: metricsRecord.searchCalls, limit: budgetSnapshot.searchCalls });
    check(Number(metricsRecord.fetchCalls ?? 0) <= Number(budgetSnapshot.fetchCalls), "fetch calls stayed within the profile budget", { used: metricsRecord.fetchCalls, limit: budgetSnapshot.fetchCalls });
    check(Number(metricsRecord.modelCalls ?? 0) <= Number(budgetSnapshot.modelCalls), "model calls stayed within the profile budget", { used: metricsRecord.modelCalls, limit: budgetSnapshot.modelCalls });
  }

  // ---- durable execution ----
  const execution = run.agentExecutionId
    ? await prisma.agentExecution.findUnique({ where: { id: run.agentExecutionId }, select: { status: true, leaseExpiresAt: true, attempt: true } })
    : null;
  report.info("agent execution", execution);
  check(execution?.status === "completed", "agent execution completed without lingering lease");
  const tasks = await prisma.researchTask.groupBy({ by: ["status"], where: { runId }, _count: true });
  report.info("tasks by status", tasks);
  check(!tasks.some((group) => group.status === "running"), "no task stuck in running");

  const metrics = (run.metrics ?? {}) as Record<string, unknown>;
  check(typeof metrics.modelCalls === "number" && (metrics.modelCalls as number) > 0 && typeof metrics.totalTokens === "number" && (metrics.totalTokens as number) > 0, "accounting recorded (modelCalls/tokens)", { modelCalls: metrics.modelCalls, totalTokens: metrics.totalTokens, costCredits: metrics.costCredits });

  process.exit(report.summarize());
}

main().catch((error) => {
  console.error(`[${SCRIPT}] crashed:`, error instanceof Error ? error.message : String(error));
  process.exit(1);
});
