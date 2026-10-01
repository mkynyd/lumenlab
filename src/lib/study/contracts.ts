import { z } from "zod";

export const collectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  stage: z.enum(["primary", "secondary", "university", "professional", "other"]),
  grade: z.string().trim().max(80).default(""),
  subject: z.string().trim().min(1).max(80),
  major: z.string().trim().max(100).default(""),
  exam: z.string().trim().max(100).default(""),
  syllabus: z.string().max(100000).default(""),
  notebookName: z.string().trim().min(1).max(100).default("错题本"),
}).strict();

// Coordinates are normalized against the processed page, independent of zoom.
export const regionSchema = z.object({
  page: z.number().int().min(0).max(999),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
  role: z.enum(["question", "continuation", "illustration", "material"]),
}).strict().refine(r => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001, {
  message: "选框必须在页面范围内",
});
export const selectedQuestionSchema = z.object({
  clientId: z.string().min(1).max(100),
  sourceOrdinal: z.string().max(80).optional(),
  regions: z.array(regionSchema).min(1).max(32),
}).strict().refine(q => q.regions.some(r => r.role === "question"), {
  message: "每道错题需要题干选框",
});
export const selectionSchema = z.object({
  notebookId: z.string().min(1).max(120),
  scanMode: z.enum(["color", "grayscale"]).default("color"),
  questions: z.array(selectedQuestionSchema).min(1).max(100),
}).strict().refine(s => new Set(s.questions.map(q => q.clientId)).size === s.questions.length, {
  message: "题目标识不能重复",
});
export const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  deadline: z.iso.datetime({ offset: true }),
  estimatedMinutes: z.number().int().min(5).max(100000),
  course: z.string().trim().max(120).default(""),
}).strict();
export const solutionSchema = z.object({
  answer: z.string().min(1).max(100000),
  explanation: z.string().min(1).max(100000),
  topics: z.array(z.string().min(1).max(200)).max(30),
}).strict();
export const verdictSchema = z.object({
  deepseekCorrect: z.boolean(),
  qwenCorrect: z.boolean(),
  evidenceComplete: z.boolean(),
  reason: z.string().min(1).max(10000),
}).strict();
export type SelectedQuestion = z.infer<typeof selectedQuestionSchema>;
export type QuestionRegion = z.infer<typeof regionSchema>;
export type CollectionInput = z.infer<typeof collectionSchema>;
export type Solution = z.infer<typeof solutionSchema>;
export type Verdict = z.infer<typeof verdictSchema>;

export function acceptedSolution(deepseek: Solution, verdict: Verdict): Solution | null {
  return verdict.deepseekCorrect && verdict.qwenCorrect && verdict.evidenceComplete ? deepseek : null;
}

export const pageManifestSchema = z.object({
  pages: z.array(z.object({ provider: z.enum(["local", "qiniu"]), key: z.string() }).strict()).max(80),
}).strict();
