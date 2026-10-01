import { describe, expect, it } from "vitest";
import { acceptedSolution, collectionSchema, selectionSchema } from "./contracts";
import { planStudyTime } from "./planner";

const question = { clientId: "q1", regions: [{ page: 0, x: 0.1, y: 0.1, width: 0.8, height: 0.2, role: "question" }] };
const at = (time: string) => `2026-10-01T${time}:00+08:00`;
describe("selected mistake boundaries", () => {
  it("requires selected questions and rejects an empty whole-paper import", () => {
    expect(selectionSchema.safeParse({ notebookId: "book", questions: [] }).success).toBe(false);
  });
  it("allows a cross-page illustration and complete shared material", () => {
    expect(selectionSchema.safeParse({ notebookId: "book", questions: [{ ...question, regions: [...question.regions,
      { page: 1, x: 0, y: 0, width: 1, height: 0.5, role: "illustration" },
      { page: 2, x: 0, y: 0, width: 1, height: 1, role: "material" },
    ] }] }).success).toBe(true);
  });
  it("rejects overflowing rectangles, missing stems, and repeated IDs", () => {
    expect(selectionSchema.safeParse({ notebookId: "book", questions: [{ ...question, regions: [{ ...question.regions[0], width: 1 }] }] }).success).toBe(false);
    expect(selectionSchema.safeParse({ notebookId: "book", questions: [{ ...question, regions: [{ ...question.regions[0], role: "illustration" }] }] }).success).toBe(false);
    expect(selectionSchema.safeParse({ notebookId: "book", questions: [question, question] }).success).toBe(false);
  });
  it("does not accept a document-supplied operation or silently retain an original", () => {
    expect(collectionSchema.safeParse({ name: "数学二", stage: "university", subject: "数学", operation: "delete" }).success).toBe(false);
  });
  it("abstains when either solver or the evidence does not pass", () => {
    const answer = { answer: "A", explanation: "推导", topics: ["极限"] };
    const verdict = { deepseekCorrect: true, qwenCorrect: true, evidenceComplete: true, reason: "独立检查通过" };
    expect(acceptedSolution(answer, verdict)).toEqual(answer);
    expect(acceptedSolution(answer, { ...verdict, qwenCorrect: false })).toBeNull();
    expect(acceptedSolution(answer, { ...verdict, evidenceComplete: false })).toBeNull();
  });
});
describe("deadline scheduling", () => {
  it("subtracts courses and merges overlapping availability without double booking", () => {
    const result = planStudyTime({ now: at("08:00"), tasks: [{ id: "a", deadline: at("12:00"), remainingMinutes: 120 }],
      availability: [{ start: at("08:00"), end: at("11:00") }, { start: at("09:00"), end: at("12:00") }],
      busy: [{ start: at("09:00"), end: at("10:00") }] });
    expect(result.feasible).toBe(true);
    expect(result.blocks.reduce((total, b) => total + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0)).toBe(120);
    expect(result.blocks.every(b => Date.parse(b.end) <= Date.parse(at("09:00")) || Date.parse(b.start) >= Date.parse(at("10:00")))).toBe(true);
  });
  it("prioritizes the nearest deadline and reports infeasible work", () => {
    const result = planStudyTime({ now: at("08:00"), tasks: [
      { id: "later", deadline: at("12:00"), remainingMinutes: 60 }, { id: "first", deadline: at("09:00"), remainingMinutes: 90 },
    ], availability: [{ start: at("08:00"), end: at("10:00") }], busy: [] });
    expect(result.blocks[0].taskId).toBe("first");
    expect(result.unscheduled).toEqual([{ taskId: "first", minutes: 30 }]);
    expect(result.feasible).toBe(false);
    expect(result.blocks.filter(b => b.taskId === "first").every(b => Date.parse(b.end) <= Date.parse(at("09:00")))).toBe(true);
  });
  it("does not schedule in the past or invent availability", () => {
    const result = planStudyTime({ now: at("10:00"), tasks: [{ id: "late", deadline: at("09:00"), remainingMinutes: 30 }], availability: [], busy: [] });
    expect(result.blocks).toEqual([]);
    expect(result.unscheduled).toEqual([{ taskId: "late", minutes: 30 }]);
  });
  it("rejects invalid intervals and duplicate tasks", () => {
    expect(() => planStudyTime({ now: at("08:00"), tasks: [], availability: [{ start: at("10:00"), end: at("09:00") }], busy: [] })).toThrow();
    const task = { id: "a", deadline: at("09:00"), remainingMinutes: 30 };
    expect(() => planStudyTime({ now: at("08:00"), tasks: [task, task], availability: [], busy: [] })).toThrow();
  });
});
