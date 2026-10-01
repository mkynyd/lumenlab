import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { expandNumberRanges, expandTimetable } from "./timetable";
import { readExcelTimetable } from "./excel-timetable";
import { readIcsTimetable } from "./ics-timetable";
const workbook = (rows: string[][]) => { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "课表"); return XLSX.write(book, { type: "buffer", bookType: "xlsx" }); };
describe("confirmed course timing", () => {
  it("reads original school week ranges without inventing dates or times", () => {
    const result = readExcelTimetable(workbook([["节次", "星期一", "星期二"], ["一", "", "课程 [1-3,5-9周] [3-4] D1219"]]));
    expect(result.events).toEqual([]);
    expect(result.patterns[0]).toEqual({ title: "课程", weekday: 2, weeks: [1, 2, 3, 5, 6, 7, 8, 9], periods: [3, 4], location: "D1219" });
    expect(result.warnings).toEqual([]);
  });
  it("expands only explicit periods and does not fill excluded weeks", () => {
    const result = expandTimetable({ termStart: "2026-09-07", patterns: [{ title: "课程", weekday: 2, weeks: [1, 3], periods: [3, 4], location: "D1219" }], periods: [{ number: 3, start: "10:30", end: "11:15" }, { number: 4, start: "11:25", end: "12:10" }] });
    expect(result.map(event => event.start)).toEqual(["2026-09-08T10:30:00+08:00", "2026-09-22T10:30:00+08:00"]);
    expect(result[0].end).toBe("2026-09-08T12:10:00+08:00");
  });
  it("requires missing periods and rejects invalid ranges", () => {
    expect(() => expandTimetable({ termStart: "2026-09-07", patterns: [{ title: "课程", weekday: 2, weeks: [1], periods: [6, 7], location: "" }], periods: [{ number: 1, start: "08:30", end: "09:15" }] })).toThrow("补全");
    expect(() => expandNumberRanges("3-1周", 60)).toThrow();
  });
  it("prefers dated course lists over duplicate summary sheets", () => {
    const result = readExcelTimetable(workbook([["日期", "时间", "课程名称", "教室"], ["2026-09-08", "14:25-16:05", "课程", "D1219"]]));
    expect(result.patterns).toEqual([]); expect(result.events).toHaveLength(1);
    expect(result.events[0].start).toBe("2026-09-08T14:25:00+08:00");
  });
  it("respects ICS repetition, excluded dates and China timezone", () => {
    const text = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:course\r\nDTSTART;TZID=Asia/Shanghai:20260908T083000\r\nDTEND;TZID=Asia/Shanghai:20260908T091500\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=Asia/Shanghai:20260915T083000\r\nSUMMARY:课程\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const result = readIcsTimetable(text, { start: "2026-09-01T00:00:00+08:00", end: "2026-10-01T00:00:00+08:00" });
    expect(result.events.map(event => event.start)).toEqual(["2026-09-08T00:30:00.000Z", "2026-09-22T00:30:00.000Z"]);
  });
});
