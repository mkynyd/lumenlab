/**
 * research-e2e-verify — 对指定 Research Run 做只读结构验证。
 *
 * 只读数据库（不调用外部 API、不创建/修改任何记录、不需要 LUMENLAB_LIVE_SMOKE）。
 * 检查 Run 状态、候选/来源/证据、evidenceKey 幂等、Sciverse locator/provenance、
 * Claim Graph（claimKey、relation、verification、source independence）、
 * ReportSnapshot/citationMap、durable lease 与 accounting。
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
