import type { AcademicDocument, DocumentBlock } from "./document-schema";

export type InsertableBlockKind = "paragraph" | "heading" | "quote" | "equation" | "list" | "table" | "bibliography" | "appendix" | "page_break";
export type HeadingMoveDirection = "up" | "down";

function textChildren(text: string) {
  return [{ kind: "text" as const, text }];
}

export function createInsertableBlock(kind: InsertableBlockKind, id: string): DocumentBlock {
  switch (kind) {
    case "heading":
      return { kind, id, level: 1, children: textChildren("新章节") };
    case "quote":
      return { kind, id, children: textChildren("引用内容") };
    case "equation":
      return { kind, id, latex: "x = 0" };
    case "list":
      return { kind, id, ordered: false, items: [textChildren("")] };
    case "table":
      return { kind, id, columns: ["列一", "列二"], rows: [["", ""]] };
    case "bibliography":
      return { kind, referenceIds: [] };
    case "appendix":
      return { kind, id, title: "附录", blocks: [] };
    case "page_break":
      return { kind, id };
    default:
      return { kind, id, children: textChildren("") };
  }
}

export function insertDocumentBlock(document: AcademicDocument, index: number, block: DocumentBlock): AcademicDocument {
  const insertionIndex = Math.max(0, Math.min(index, document.blocks.length));
  return { ...document, blocks: [...document.blocks.slice(0, insertionIndex), block, ...document.blocks.slice(insertionIndex)] };
}

export function removeDocumentBlock(document: AcademicDocument, index: number): AcademicDocument {
  const block = document.blocks[index];
  if (!block || block.kind === "paper_metadata") return document;
  return { ...document, blocks: [...document.blocks.slice(0, index), ...document.blocks.slice(index + 1)] };
}

export function updateDocumentBlockText(document: AcademicDocument, index: number, text: string): AcademicDocument {
  const block = document.blocks[index];
  if (!block || !("children" in block) || !Array.isArray(block.children)) return document;
  return { ...document, blocks: document.blocks.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, children: textChildren(text) } : candidate) };
}

function headingSubtreeEnd(blocks: DocumentBlock[], start: number): number {
  const block = blocks[start];
  if (!block || block.kind !== "heading") return start + 1;
  for (let index = start + 1; index < blocks.length; index += 1) {
    const candidate = blocks[index];
    if (candidate.kind === "heading" && candidate.level <= block.level) return index;
  }
  return blocks.length;
}

export function moveHeadingSubtree(document: AcademicDocument, index: number, direction: HeadingMoveDirection): AcademicDocument {
  const block = document.blocks[index];
  if (!block || block.kind !== "heading") return document;
  const end = headingSubtreeEnd(document.blocks, index);
  if (direction === "up") {
    const previousStart = [...document.blocks.slice(0, index)].map((candidate, candidateIndex) => ({ candidate, candidateIndex })).reverse().find(({ candidate }) => candidate.kind === "heading" && candidate.level === block.level)?.candidateIndex;
    if (previousStart === undefined) return document;
    return { ...document, blocks: [...document.blocks.slice(0, previousStart), ...document.blocks.slice(index, end), ...document.blocks.slice(previousStart, index), ...document.blocks.slice(end)] };
  }
  const nextStart = end;
  const next = document.blocks[nextStart];
  if (!next || next.kind !== "heading" || next.level !== block.level) return document;
  const nextEnd = headingSubtreeEnd(document.blocks, nextStart);
  return { ...document, blocks: [...document.blocks.slice(0, index), ...document.blocks.slice(nextStart, nextEnd), ...document.blocks.slice(index, end), ...document.blocks.slice(nextEnd)] };
}

/** Move a complete heading subtree before another block, preserving all child blocks. */
export function moveHeadingSubtreeTo(document: AcademicDocument, sourceIndex: number, targetIndex: number): AcademicDocument {
  const source = document.blocks[sourceIndex];
  const target = document.blocks[targetIndex];
  if (!source || source.kind !== "heading" || !target || sourceIndex === targetIndex) return document;
  const sourceEnd = headingSubtreeEnd(document.blocks, sourceIndex);
  if (targetIndex >= sourceIndex && targetIndex < sourceEnd) return document;
  const subtree = document.blocks.slice(sourceIndex, sourceEnd);
  const remaining = [...document.blocks.slice(0, sourceIndex), ...document.blocks.slice(sourceEnd)];
  const adjustedTarget = targetIndex > sourceIndex ? targetIndex - subtree.length : targetIndex;
  return { ...document, blocks: [...remaining.slice(0, adjustedTarget), ...subtree, ...remaining.slice(adjustedTarget)] };
}
