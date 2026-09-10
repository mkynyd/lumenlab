const RESEARCH_EVIDENCE_ANCHOR_PREFIX = "research-evidence-";

export function researchEvidenceAnchor(evidenceId: string) {
  return `#${RESEARCH_EVIDENCE_ANCHOR_PREFIX}${encodeURIComponent(evidenceId)}`;
}

export function researchEvidenceIdFromAnchor(href: string) {
  const prefix = `#${RESEARCH_EVIDENCE_ANCHOR_PREFIX}`;
  if (!href.startsWith(prefix)) return null;
  const encodedId = href.slice(prefix.length);
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

/**
 * Convert only the stable [E1] markers emitted by the Synthesizer into
 * internal links. Unknown markers remain plain text so a model cannot create
 * a link to evidence that is not part of the immutable report snapshot.
 */
export function linkifyResearchEvidenceMarkers(body: string, evidenceIds: readonly string[]) {
  return body.replace(/\[E(\d+)\](?!\()/g, (marker, indexText: string) => {
    const evidenceId = evidenceIds[Number(indexText) - 1];
    if (!evidenceId) return marker;
    return `[E${indexText}](${researchEvidenceAnchor(evidenceId)})`;
  });
}

export interface CitationMapSourceRef {
  id: string;
  kind: string;
  title: string | null;
  canonicalUrl: string | null;
  doi: string | null;
  provider: string | null;
}

export interface CitationMapEntry {
  evidenceId: string;
  sourceSnapshotId: string;
  relation: string;
  locator: Record<string, unknown> | null;
  source: CitationMapSourceRef;
}

/**
 * 构建可审计的 citation map：Evidence → ResearchSourceSnapshot → ResearchSource。
 * locator.kind 区分 web url 与 sciverse chunk（kind:"sciverse" 带 docId/chunkId/offset）。
 */
export function buildResearchCitationMap(claims: Array<{
  id: string;
  evidenceRelations: Array<{
    evidenceId: string;
    relation: string;
    evidence: {
      locator: unknown;
      sourceSnapshotId: string;
      sourceSnapshot: {
        metadata: unknown;
        source: {
          id: string;
          kind: string;
          title: string | null;
          canonicalUrl: string | null;
          doi: string | null;
        };
      };
    };
  }>;
}>): Record<string, CitationMapEntry[]> {
  return Object.fromEntries(claims.map((claim) => [
    claim.id,
    claim.evidenceRelations.map((relation) => {
      const snapshotMetadata = relation.evidence.sourceSnapshot.metadata && typeof relation.evidence.sourceSnapshot.metadata === "object"
        ? relation.evidence.sourceSnapshot.metadata as Record<string, unknown>
        : {};
      const source = relation.evidence.sourceSnapshot.source;
      return {
        evidenceId: relation.evidenceId,
        sourceSnapshotId: relation.evidence.sourceSnapshotId,
        relation: relation.relation,
        locator: relation.evidence.locator && typeof relation.evidence.locator === "object" ? relation.evidence.locator as Record<string, unknown> : null,
        source: {
          id: source.id,
          kind: source.kind,
          title: source.title,
          canonicalUrl: source.canonicalUrl,
          doi: source.doi,
          provider: typeof snapshotMetadata.provider === "string" ? snapshotMetadata.provider : null,
        },
      };
    }),
  ]));
}
