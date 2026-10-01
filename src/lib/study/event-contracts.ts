import { z } from "zod";
export const eventInput = z.object({ title: z.string().trim().min(1).max(200), kind: z.enum(["course", "busy"]), start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }).strict().refine(event => Date.parse(event.end) > Date.parse(event.start) && Date.parse(event.end) - Date.parse(event.start) <= 7 * 86400000, { message: "日程结束须晚于开始且不超过7天" });
