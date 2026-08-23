import type { AcademicDocument, DocumentBlock } from "./document-schema";
import { parseAcademicDocument } from "./document-schema";

export type DocumentPatchOperation =
  | { kind: "replace_block"; blockId: string; block: DocumentBlock }
  | { kind: "insert_block"; index: number; block: DocumentBlock }
  | { kind: "delete_block"; blockId: string }
  | { kind: "move_block"; blockId: string; index: number };

export interface DocumentPatch {
  schemaVersion: "1";
  baseVersion: number;
  summary: string;
  operations: DocumentPatchOperation[];
}

function blockId(block: DocumentBlock): string | null {
  return "id" in block && typeof block.id === "string" ? block.id : null;
}

export function applyDocumentPatch(
  document: AcademicDocument,
  patch: DocumentPatch
): AcademicDocument {
  if (patch.schemaVersion !== "1") throw new Error("不支持的 Document Patch 版本");
  const blocks = [...document.blocks];
  for (const operation of patch.operations) {
    if (operation.kind === "insert_block") {
      if (operation.index < 0 || operation.index > blocks.length) throw new Error("插入位置无效");
      blocks.splice(operation.index, 0, operation.block);
      continue;
    }
    const index = blocks.findIndex((block) => blockId(block) === operation.blockId);
    if (index < 0) throw new Error(`找不到 Document block: ${operation.blockId}`);
    if (operation.kind === "replace_block") blocks[index] = operation.block;
    if (operation.kind === "delete_block") blocks.splice(index, 1);
    if (operation.kind === "move_block") {
      if (operation.index < 0 || operation.index >= blocks.length) throw new Error("移动位置无效");
      const [block] = blocks.splice(index, 1);
      blocks.splice(operation.index, 0, block);
    }
  }
  return parseAcademicDocument({ ...document, blocks });
}

export function assertPatchBaseVersion(actualVersion: number, patch: DocumentPatch): void {
  if (actualVersion !== patch.baseVersion) {
    throw new Error("Document Patch 基于旧版本，不能直接应用");
  }
}
