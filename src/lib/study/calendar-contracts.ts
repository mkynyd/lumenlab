import { z } from "zod";
import { coursePatternSchema, periodSchema } from "./timetable";
export const courseEventSchema = z.object({ title: z.string().trim().min(1).max(200), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }), location: z.string().max(200).default("") }).strict().refine(event => Date.parse(event.start) < Date.parse(event.end), { message: "事件结束须晚于开始" });
export const timetablePreviewSchema = z.object({ patterns: z.array(coursePatternSchema).max(300), events: z.array(courseEventSchema).max(2000), warnings: z.array(z.string().max(500)).max(300) }).strict();
export const timetableApplySchema = z.object({ patterns: z.array(coursePatternSchema).max(300), events: z.array(courseEventSchema).max(2000), termStart: z.string().max(10), periods: z.array(periodSchema).max(30), replace: z.boolean().default(false), confirmed: z.literal(true) }).strict();
