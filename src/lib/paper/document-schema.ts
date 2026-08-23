import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

export const inlineNodeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }).strict(),
  z.object({ kind: z.literal("bold"), children: z.array(z.unknown()).min(1) }).strict(),
  z.object({ kind: z.literal("italic"), children: z.array(z.unknown()).min(1) }).strict(),
  z.object({ kind: z.literal("superscript"), children: z.array(z.unknown()).min(1) }).strict(),
  z.object({ kind: z.literal("subscript"), children: z.array(z.unknown()).min(1) }).strict(),
  z.object({ kind: z.literal("inline_math"), latex: nonEmpty }).strict(),
  z.object({ kind: z.literal("citation"), referenceId: nonEmpty }).strict(),
  z.object({ kind: z.literal("cross_reference"), targetId: nonEmpty }).strict(),
  z.object({ kind: z.literal("footnote"), id: nonEmpty, children: z.array(z.unknown()).min(1) }).strict(),
]);

const children = z.array(inlineNodeSchema).default([]);

export const documentBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("paper_metadata"),
    title: nonEmpty,
    authors: z.array(nonEmpty).min(1),
    institution: z.string().optional(),
    degreeType: z.string().optional(),
    date: z.string().optional(),
  }).strict(),
  z.object({ kind: z.literal("abstract"), language: z.enum(["zh", "en"]), children }).strict(),
  z.object({ kind: z.literal("keywords"), language: z.enum(["zh", "en"]), keywords: z.array(nonEmpty).min(1) }).strict(),
  z.object({ kind: z.literal("heading"), id: nonEmpty, level: z.number().int().min(1).max(6), children }).strict(),
  z.object({ kind: z.literal("paragraph"), id: nonEmpty, children }).strict(),
  z.object({
    kind: z.literal("figure"),
    id: nonEmpty,
    assetId: nonEmpty,
    caption: z.string(),
    label: z.string().optional(),
    width: z.number().positive().max(1).optional(),
    alignment: z.enum(["left", "center", "right"]).default("center"),
    placement: z.enum(["here", "top", "bottom", "float"]).default("float"),
  }).strict(),
  z.object({
    kind: z.literal("table"),
    id: nonEmpty,
    columns: z.array(nonEmpty).min(1),
    rows: z.array(z.array(z.string())).min(1),
    caption: z.string().optional(),
    label: z.string().optional(),
  }).strict(),
  z.object({ kind: z.literal("equation"), id: nonEmpty, latex: nonEmpty, label: z.string().optional() }).strict(),
  z.object({ kind: z.literal("list"), id: nonEmpty, ordered: z.boolean(), items: z.array(children).min(1) }).strict(),
  z.object({ kind: z.literal("quote"), id: nonEmpty, children, attribution: z.string().optional() }).strict(),
  z.object({ kind: z.literal("bibliography"), referenceIds: z.array(nonEmpty) }).strict(),
  z.object({ kind: z.literal("appendix"), id: nonEmpty, title: nonEmpty, blocks: z.array(z.unknown()).default([]) }).strict(),
  z.object({ kind: z.literal("acknowledgement"), children }).strict(),
  z.object({ kind: z.literal("page_break"), id: nonEmpty }).strict(),
  z.object({ kind: z.literal("raw_latex"), id: nonEmpty, latex: z.string() }).strict(),
]);

export const academicDocumentSchema = z.object({
  schemaVersion: z.literal("1"),
  title: z.string().default("未命名论文"),
  blocks: z.array(documentBlockSchema),
}).strict();

export type InlineNode = z.infer<typeof inlineNodeSchema>;
export type DocumentBlock = z.infer<typeof documentBlockSchema>;
export type AcademicDocument = z.infer<typeof academicDocumentSchema>;

export function buildEmptyAcademicDocument(title = "未命名论文"): AcademicDocument {
  return academicDocumentSchema.parse({
    schemaVersion: "1",
    title,
    blocks: [
      {
        kind: "paper_metadata",
        title,
        authors: ["作者"],
      },
      {
        kind: "abstract",
        language: "zh",
        children: [{ kind: "text", text: "" }],
      },
      {
        kind: "heading",
        id: "section-1",
        level: 1,
        children: [{ kind: "text", text: "第一章" }],
      },
      {
        kind: "paragraph",
        id: "paragraph-1",
        children: [{ kind: "text", text: "" }],
      },
    ],
  });
}

export function parseAcademicDocument(value: unknown): AcademicDocument {
  return academicDocumentSchema.parse(value);
}

export function serializeAcademicDocument(value: AcademicDocument): string {
  return JSON.stringify(parseAcademicDocument(value));
}
