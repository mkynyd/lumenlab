import "server-only";
import * as XLSX from "xlsx";
import { expandNumberRanges, validLocalDate, type CoursePattern, type CourseEvent } from "./timetable";
export function readExcelTimetable(data: Buffer): { patterns: CoursePattern[]; events: CourseEvent[]; warnings: string[] } {
  const workbook = XLSX.read(data, { type: "buffer" });
  const warnings: string[] = [], patterns: CoursePattern[] = [], events: CourseEvent[] = [];
  const seen = new Set<string>();
  // A dated list is unambiguous; do not additionally import its summary sheets.
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false });
    const header = rows.findIndex(row => row.includes("日期") && row.includes("课程名称") && row.includes("时间"));
    if (header < 0) continue;
    const columns = rows[header];
    for (const row of rows.slice(header + 1)) {
      const title = row[columns.indexOf("课程名称")];
      if (!title) continue;
      const date = row[columns.indexOf("日期")], time = row[columns.indexOf("时间")];
      const match = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/.exec(time ?? "");
      if (!validLocalDate(date) || !match || match[1] >= match[2] || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(match[1]) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(match[2])) { warnings.push(`${name}：${title} 的日期或时间需要确认`); continue; }
      events.push({ title, start: `${date}T${match[1]}:00+08:00`, end: `${date}T${match[2]}:00+08:00`, location: row[columns.indexOf("教室")] ?? "" });
    }
    return { patterns, events, warnings };
  }
  const weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false });
    const header = rows.findIndex(row => weekdays.some(day => row.includes(day)));
    if (header < 0) continue;
    for (const row of rows.slice(header + 1)) for (const [day, weekday] of weekdays.entries()) {
      const column = rows[header].indexOf(weekday);
      if (column < 0) continue;
      for (const line of String(row[column] ?? "").split(/\r?\n/).map(text => text.trim()).filter(Boolean)) {
        const match = /^(.*?)\s*\[([^\]]+周)\]\s*\[([^\]]+)\]\s*(.*)$/.exec(line);
        if (!match) { warnings.push(`${name}：未识别课程单元格 ${line.slice(0, 200)}`); continue; }
        try {
          const pattern = { title: match[1].trim(), weekday: day + 1, weeks: expandNumberRanges(match[2], 60), periods: expandNumberRanges(match[3], 30), location: match[4].trim() };
          const key = JSON.stringify(pattern);
          if (!seen.has(key)) { patterns.push(pattern); seen.add(key); }
        } catch { warnings.push(`${name}：${line.slice(0, 200)} 周次或节次需确认`); }
      }
    }
  }
  if (!patterns.length && !events.length) warnings.push("没有找到明确的课程，请使用图片/PDF识别或手动录入");
  return { patterns, events, warnings };
}
