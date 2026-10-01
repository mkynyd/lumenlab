import { describe, expect, it } from "vitest";
import { textSelectionSchema, extractSelectedText } from "./text-selection";
import { chinaHolidays, chinaMakeupWorkdays, holidayBusyWindows } from "./holidays";
import { planStudyTime } from "./planner";
describe("exact text selection and calendar constraints", () => {
  it("preserves complete chosen substrings and formulas while excluding unselected questions", () => {
    const source = '长文全文\n第1题 $x^2$\nA.甲 B.乙\n第2题不要收录';
    const end = source.indexOf('第2题');
    const parsed = textSelectionSchema.parse({ notebookId: 'book', source, questions: [{ ordinal: '1', ranges: [{ start: 0, end }] }] });
    expect(extractSelectedText(parsed)[0].prompt).toBe(source.slice(0, end));
    expect(extractSelectedText(parsed)[0].prompt).not.toContain('不要收录');
  });
  it("rejects out-of-source offsets and whole-source empty selection", () => {
    expect(textSelectionSchema.safeParse({ notebookId: 'book', source: '短题', questions: [{ ordinal: '1', ranges: [{ start: 0, end: 999 }] }] }).success).toBe(false);
    expect(textSelectionSchema.safeParse({ notebookId: 'book', source: '短题', questions: [] }).success).toBe(false);
  });
  it("treats confirmed 2026 holidays as busy without inventing 2027 holidays", () => {
    expect(chinaHolidays.some(day => day.date === '2026-10-01')).toBe(true);
    expect(chinaHolidays.some(day => day.date.startsWith('2027'))).toBe(false);
    expect(chinaMakeupWorkdays).toContain('2026-10-10');
    const plan = planStudyTime({ now: '2026-10-01T08:00:00+08:00', availability: [{ start: '2026-10-01T09:00:00+08:00', end: '2026-10-01T11:00:00+08:00' }], busy: holidayBusyWindows, tasks: [{ id: 'task', remainingMinutes: 60, deadline: '2026-10-01T12:00:00+08:00' }] });
    expect(plan.blocks).toEqual([]);
    expect(plan.feasible).toBe(false);
  });
});
