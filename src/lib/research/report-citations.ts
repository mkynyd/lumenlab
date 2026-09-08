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
