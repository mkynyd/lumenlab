import { z } from "zod";
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const coursePatternSchema = z.object({
  title: z.string().min(1).max(200), weekday: z.number().int().min(1).max(7),
  weeks: z.array(z.number().int().min(1).max(60)).min(1).max(60),
  periods: z.array(z.number().int().min(1).max(30)).min(1).max(30), location: z.string().max(200).default(""),
}).strict();
export const periodSchema = z.object({ number: z.number().int().min(1).max(30), start: clock, end: clock }).strict().refine(p => p.start < p.end, { message: "节次结束须晚于开始" });
export type CoursePattern = z.infer<typeof coursePatternSchema>;
export interface CourseEvent { title: string; start: string; end: string; location: string }
export function expandNumberRanges(source: string, maximum: number): number[] {
  const text = source.replace(/周|第|节|\s/g, "").replace(/[，、]/g, ",");
  const result = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) throw new Error("周次或节次格式不明确");
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > maximum) throw new Error("周次或节次超出范围");
    for (let value = start; value <= end; value++) result.add(value);
  }
  return [...result].sort((a, b) => a - b);
}
export function validLocalDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
export function expandTimetable(input: { patterns: CoursePattern[]; termStart: string; periods: z.infer<typeof periodSchema>[] }): CourseEvent[] {
  if (!validLocalDate(input.termStart) || new Date(`${input.termStart}T00:00:00Z`).getUTCDay() !== 1) throw new Error("请确认第1周星期一日期");
  const parsed = z.array(periodSchema).min(1).max(30).safeParse(input.periods);
  if (!parsed.success) throw new Error("请补全每个节次的开始与结束时间");
  const periods = parsed.data;
  if (new Set(periods.map(period => period.number)).size !== periods.length) throw new Error("节次不能重复");
  const sorted = [...periods].sort((a, b) => a.number - b.number);
  if (sorted.some((period, index) => index > 0 && period.start < sorted[index - 1].end)) throw new Error("节次时间重叠或顺序错误");
  const map = new Map(periods.map(period => [period.number, period]));
  const events: CourseEvent[] = [];
  const seen = new Set<string>();
  for (const raw of input.patterns) {
    const pattern = coursePatternSchema.parse(raw);
    const numbers = [...new Set(pattern.periods)].sort((a, b) => a - b);
    if (numbers.some(number => !map.has(number))) throw new Error(`${pattern.title}：请补全第${numbers.filter(number => !map.has(number)).join("、")}节时间`);
    // Separate non-contiguous period groups instead of occupying the intervening classes.
    const groups: number[][] = [];
    for (const number of numbers) { const last = groups.at(-1); if (last && last.at(-1)! + 1 === number) last.push(number); else groups.push([number]); }
    for (const week of [...new Set(pattern.weeks)]) {
      const date = new Date(`${input.termStart}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + (week - 1) * 7 + pattern.weekday - 1);
      const key = date.toISOString().slice(0, 10);
      for (const group of groups) {
        const event = { title: pattern.title, start: `${key}T${map.get(group[0])!.start}:00+08:00`, end: `${key}T${map.get(group.at(-1)!)!.end}:00+08:00`, location: pattern.location };
        const fingerprint = JSON.stringify(event);
        if (!seen.has(fingerprint)) { events.push(event); seen.add(fingerprint); }
      }
    }
  }
  return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
