import { z } from "zod";

export const textSelectionSchema = z.object({
  notebookId: z.string().min(1).max(120),
  source: z.string().min(1).max(1000000),
  questions: z.array(z.object({ ordinal: z.string().max(80), ranges: z.array(z.object({ start: z.number().int().min(0), end: z.number().int().positive() }).strict()).min(1).max(32) }).strict()).min(1).max(100),
}).strict().superRefine((input, ctx) => {
  for (const question of input.questions) for (const range of question.ranges) {
    if (range.end <= range.start || range.end > input.source.length) ctx.addIssue({ code: "custom", message: "选择范围无效", path: ["questions"] });
  }
});
export function extractSelectedText(input: z.infer<typeof textSelectionSchema>) {
  return input.questions.map(question => ({ ordinal: question.ordinal, prompt: question.ranges.map(range => input.source.slice(range.start, range.end)).join("\n\n") }));
}
