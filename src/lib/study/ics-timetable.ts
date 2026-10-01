import ICAL from "ical.js";
import type { CourseEvent } from "./timetable";
/** Expansion is explicit and bounded; timezone definitions stay local to this calendar. */
export function readIcsTimetable(text: string, window: { start: string; end: string }) {
  const lower = Date.parse(window.start), upper = Date.parse(window.end);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper || upper - lower > 366 * 86400000) throw new Error("请设置不超过一年的课表导入范围");
  if (text.length > 5 * 1024 * 1024) throw new Error("ICS文件过大");
  const root = new ICAL.Component(ICAL.parse(text));
  if (root.name !== "vcalendar") throw new Error("无效的ICS日历");
  if (!root.getTimeZoneByID("Asia/Shanghai")) root.addSubcomponent(new ICAL.Component(ICAL.parse("BEGIN:VTIMEZONE\r\nTZID:Asia/Shanghai\r\nBEGIN:STANDARD\r\nDTSTART:19920101T000000\r\nTZOFFSETFROM:+0800\r\nTZOFFSETTO:+0800\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n")));
  const warnings = new Set<string>(), events: CourseEvent[] = [];
  const components = root.getAllSubcomponents("vevent");
  if (components.length > 2000) throw new Error("课程条目过多，请分批导入");
  for (const component of components) {
    const event = new ICAL.Event(component);
    if (event.isRecurrenceException() || component.getFirstPropertyValue("status") === "CANCELLED") continue;
    for (const property of ["dtstart", "dtend"]) {
      const prop = component.getFirstProperty(property);
      const zone = prop?.getParameter("tzid");
      if (zone && zone !== "UTC" && zone !== "Etc/UTC" && !root.getTimeZoneByID(String(zone))) throw new Error(`缺少${zone}的时区定义，请导出包含VTIMEZONE的ICS`);
    }
    if (event.startDate.isDate) { warnings.add("全天事件未作为课程导入，请在预览中检查学校安排"); continue; }
    const rule = component.getFirstPropertyValue("rrule") as ICAL.Recur | null;
    if (rule && !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.freq)) throw new Error("不支持按小时或分钟循环的课程事件");
    const iterator = event.iterator();
    let steps = 0;
    for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
      if (++steps > 4000) throw new Error("循环课程展开超过上限，请缩小导入范围");
      const details = event.getOccurrenceDetails(occurrence);
      const date = (time: ICAL.Time) => {
        if (time.zone.tzid === "floating") {
          warnings.add("没有时区的课程按北京时间处理，请确认");
          return Date.parse(`${time.toString()}+08:00`);
        }
        return time.toUnixTime() * 1000;
      };
      const start = date(details.startDate), end = date(details.endDate);
      if (start >= upper) break;
      if (details.item.component.getFirstPropertyValue("status") === "CANCELLED" || start < lower) continue;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("课程开始或结束时间无效");
      events.push({ title: details.item.summary || "未命名课程", start: new Date(start).toISOString(), end: new Date(end).toISOString(), location: details.item.location || "" });
      if (events.length > 2000) throw new Error("课程展开数量过多，请分批导入");
    }
  }
  return { patterns: [], events, warnings: [...warnings] };
}
