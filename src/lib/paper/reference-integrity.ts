export interface ReferenceIntegrityInline {
  kind?: string;
  referenceId?: string;
  children?: ReferenceIntegrityInline[];
}

export interface ReferenceIntegrityBlock {
  children?: ReferenceIntegrityInline[];
  items?: ReferenceIntegrityInline[][];
  referenceIds?: string[];
}

export interface ReferenceIntegrityDocument {
  blocks: ReferenceIntegrityBlock[];
}

export function collectDocumentReferenceIds(document: ReferenceIntegrityDocument): string[] {
  const ids = new Set<string>();
  const collectInline = (nodes: ReferenceIntegrityInline[]) => {
    for (const node of nodes) {
      if (node.kind === "citation" && node.referenceId) ids.add(node.referenceId);
      if (node.children) collectInline(node.children);
    }
  };
  for (const block of document.blocks) {
    if (block.children) collectInline(block.children);
    for (const item of block.items ?? []) collectInline(item);
    for (const referenceId of block.referenceIds ?? []) if (referenceId) ids.add(referenceId);
  }
  return [...ids];
}

export function findMissingDocumentReferenceIds(document: ReferenceIntegrityDocument, knownReferenceIds: readonly string[]): string[] {
  const known = new Set(knownReferenceIds);
  return collectDocumentReferenceIds(document).filter((referenceId) => !known.has(referenceId));
}
