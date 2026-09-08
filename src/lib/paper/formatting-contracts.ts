import { z } from "zod";

export const FORMATTING_STAGES = ["queued", "importing", "mapping", "needs_input", "rendering", "compiling", "validating", "completed", "failed", "cancelled"] as const;
export type FormattingStage = typeof FORMATTING_STAGES[number];
export const FORMATTING_STAGE_LABELS: Record<FormattingStage, string> = {
  queued: "排队中", importing: "读取原稿", mapping: "识别章节结构", needs_input: "等待结构确认",
  rendering: "应用学校模板", compiling: "生成 PDF", validating: "检查排版结果", completed: "排版完成", failed: "排版失败", cancelled: "已取消",
};
export const ACTIVE_FORMATTING_STAGES: FormattingStage[] = ["queued", "importing", "mapping", "needs_input", "rendering", "compiling", "validating"];
export const MAX_FORMATTING_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_FORMATTING_BATCHES = 100;
export const FORMATTING_MAPPING_VERSION = "paper-roles-v1";
export const formattingMetadataSchema = z.object({
  title: z.string().trim().min(1).max(500),
  authors: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  institution: z.string().trim().max(200).optional(),
  degreeType: z.string().trim().max(100).optional(),
  date: z.string().trim().max(50).optional(),
  studentId: z.string().trim().max(100).optional(),
  department: z.string().trim().max(200).optional(),
  major: z.string().trim().max(200).optional(),
  supervisor: z.string().trim().max(200).optional(),
}).strict();
export type FormattingMetadata = z.infer<typeof formattingMetadataSchema>;
export const formattingSubmissionSchema = z.object({
  requestKey: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/),
  templateVariantId: z.string().min(1).max(150),
  metadata: formattingMetadataSchema,
}).strict();
export const formattingRoleSchema = z.object({
  blockId: z.string().min(1).max(150),
  role: z.enum(["keep", "heading", "abstract_zh", "abstract_en", "acknowledgement"]),
  level: z.number().int().min(1).max(6).optional(),
  confidence: z.number().min(0).max(1),
}).strict();
export type FormattingRole = z.infer<typeof formattingRoleSchema>;
export const formattingMappingSchema = z.object({ roles: z.array(formattingRoleSchema).max(80) }).strict();

export class FormattingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export function formattingSourceType(filename: string): "docx" | "markdown" {
  if (/\.docx$/i.test(filename)) return "docx";
  if (/\.(md|markdown)$/i.test(filename)) return "markdown";
  if (/\.doc$/i.test(filename)) throw new FormattingError("LEGACY_DOC", "请在 Word 中将 .doc 原稿另存为 .docx 后上传，修改扩展名无法转换格式。");
  throw new FormattingError("UNSUPPORTED_FORMAT", "请上传 DOCX 或 Markdown（.md / .markdown）原稿。");
}
