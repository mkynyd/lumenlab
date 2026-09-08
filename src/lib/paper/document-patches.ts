import type { AcademicDocument, DocumentBlock } from "./document-schema";
import { documentBlockSchema, parseAcademicDocument } from "./document-schema";
import { z } from "zod";

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

const documentPatchOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replace_block"), blockId: z.string().trim().min(1), block: documentBlockSchema }).strict(),
  z.object({ kind: z.literal("insert_block"), index: z.number().int().nonnegative(), block: documentBlockSchema }).strict(),
  z.object({ kind: z.literal("delete_block"), blockId: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal("move_block"), blockId: z.string().trim().min(1), index: z.number().int().nonnegative() }).strict(),
]);

export const documentPatchSchema = z.object({
  schemaVersion: z.literal("1"),
  baseVersion: z.number().int().positive(),
  summary: z.string().trim().min(1).max(1_000),
  operations: z.array(documentPatchOperationSchema).max(40),
}).strict();

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
    if (blocks[index].kind === "paper_metadata" && operation.kind !== "replace_block") throw new Error("不能删除或移动论文元数据块");
    if (operation.kind === "replace_block") {
      if (blocks[index].kind === "paper_metadata" && operation.block.kind !== "paper_metadata") throw new Error("不能用其他块替换论文元数据块");
      blocks[index] = operation.block;
    }
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
