/**
 * Deep Research Production Validation v1 — post-run verification (uncommitted ops script).
 * Read-only checks against the smoke Run; prints bounded, non-sensitive summaries.
 *
 * Usage: SMOKE_RUN_ID=<run id> npx tsx scripts/research-e2e-verify.ts
 */
import { prisma } from "@/lib/db";

function log(message: string, data?: unknown) {
  console.log(`[verify] ${message}${data !== undefined ? ` ${JSON.stringify(data)}` : ""}`);
}

async function main() {
  const runId = process.env.SMOKE_RUN_ID?.trim();
  if (!runId) throw new Error("SMOKE_RUN_ID required");
  let failures = 0;
  const check = (ok: boolean, label: string, detail?: unknown) => {
    log(`${ok ? "PASS" : "FAIL"} ${label}`, detail);
    if (!ok) failures += 1;
  };

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
  log("candidates by provider/status", byProvider);
  check(candidates.some((candidate) => candidate.provider === "sciverse" && candidate.status === "fetched"), "sciverse candidate fetched");
  check(candidates.some((candidate) => candidate.provider === "anysearch" || candidate.provider === "web" || candidates.some((c) => c.provider !== "sciverse" && c.status === "fetched")), "web channel present alongside sciverse");

  // ---- evidence ----
  const evidences = await prisma.evidence.findMany({
    where: { runId },
    include: { sourceSnapshot: { include: { source: true } } },
    orderBy: { createdAt: "asc" },
  });
  log("evidence count", evidences.length);
  const keyCount = evidences.filter((evidence) => evidence.evidenceKey).length;
  check(keyCount === evidences.length, "all system evidence has deterministic evidenceKey", { withKey: keyCount, total: evidences.length });
  const keySet = new Set(evidences.map((evidence) => evidence.evidenceKey));
  check(keySet.size === keyCount, "no duplicate chunk evidence (evidenceKey unique)", { unique: keySet.size, total: keyCount });

  const sciverseEvidence = evidences.filter((evidence) => {
    const locator = evidence.locator as Record<string, unknown> | null;
    return locator?.kind === "sciverse";
  });
  check(sciverseEvidence.length > 0, "sciverse chunk evidence exists", { count: sciverseEvidence.length });
  const sample = sciverseEvidence[0];
  if (sample) {
    const locator = sample.locator as Record<string, unknown>;
    const provenance = (sample.provenance ?? {}) as Record<string, unknown>;
    check(Boolean(locator.docId) && (Boolean(locator.chunkId) || typeof locator.offset === "number"), "sciverse locator has docId/chunkId/offset", { locator });
    check(typeof provenance.retrievalMethod === "string" && typeof provenance.provider === "string", "provenance keeps retrieval method/provider", { retrievalMethod: provenance.retrievalMethod, provider: provenance.provider, semanticScore: provenance.semanticScore });
    check(sample.evidenceType === "direct_quote", "raw passage uses direct_quote", { evidenceType: sample.evidenceType });
  }
  const snapshotScope = sample ? (sample.sourceSnapshot.metadata as Record<string, unknown> | null)?.scope : null;
  log("sample snapshot scope", snapshotScope);

  // ---- claims ----
  const claims = await prisma.claim.findMany({
    where: { runId },
    include: { evidenceRelations: { include: { evidence: { include: { sourceSnapshot: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const activeClaims = claims.filter((claim) => claim.status === "active" || claim.status === "disputed");
  log("claims", { total: claims.length, active: activeClaims.length, superseded: claims.length - activeClaims.length });
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
    log("claim", {
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
  const report = run.reportSnapshot;
  check(Boolean(report), "report snapshot frozen");
  if (report) {
    const citationMap = report.citationMap as Record<string, Array<{ evidenceId: string; relation: string; source: { title: string | null; doi: string | null; canonicalUrl: string | null; provider: string | null } }>>;
    log("report refs", { evidenceIds: report.evidenceIds.length, sourceSnapshotIds: report.sourceSnapshotIds.length, citationEntries: Object.keys(citationMap).length });
    const entries = Object.entries(citationMap).slice(0, 2);
    for (const [claimId, refs] of entries) {
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
      void claimId;
    }
    const body = ((report.reportDocument as Record<string, unknown>)?.body as string) ?? "";
    const markers = [...new Set([...body.matchAll(/\[E(\d+)\]/g)].map((match) => Number(match[1])))];
    check(markers.every((index) => index >= 1 && index <= report.evidenceIds.length), "all [E#] markers resolve to snapshot evidence", { markers: markers.slice(0, 10), evidenceCount: report.evidenceIds.length });
    const relationEvidenceIds = new Set(activeClaims.flatMap((claim) => claim.evidenceRelations.map((relation) => relation.evidenceId)));
    const sampleMarkers = markers.slice(0, 2);
    for (const index of sampleMarkers) {
      const evidenceId = report.evidenceIds[index - 1];
      check(relationEvidenceIds.has(evidenceId), `marker E${index} evidence participates in a ClaimEvidenceRelation`);
    }
    log("report body preview", body.slice(0, 400));
  }

  // ---- durable execution ----
  const execution = run.agentExecutionId
    ? await prisma.agentExecution.findUnique({ where: { id: run.agentExecutionId }, select: { status: true, leaseExpiresAt: true, attempt: true } })
    : null;
  log("agent execution", execution);
  check(execution?.status === "completed", "agent execution completed without lingering lease");
  const tasks = await prisma.researchTask.groupBy({ by: ["status"], where: { runId }, _count: true });
  log("tasks by status", tasks);
  check(!tasks.some((group) => group.status === "running"), "no task stuck in running");

  const metrics = (run.metrics ?? {}) as Record<string, unknown>;
  check(typeof metrics.modelCalls === "number" && (metrics.modelCalls as number) > 0 && typeof metrics.totalTokens === "number" && (metrics.totalTokens as number) > 0, "accounting recorded (modelCalls/tokens)", { modelCalls: metrics.modelCalls, totalTokens: metrics.totalTokens, costCredits: metrics.costCredits });

  log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error("[verify] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
