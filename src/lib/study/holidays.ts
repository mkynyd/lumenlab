// 国办发明电〔2025〕7号. Source verified 2026-10-01; future years are not inferred.
export const holidaySource = "https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html";
const ranges = [
  ["元旦", "2026-01-01", "2026-01-03"], ["春节", "2026-02-15", "2026-02-23"],
  ["清明节", "2026-04-04", "2026-04-06"], ["劳动节", "2026-05-01", "2026-05-05"],
  ["端午节", "2026-06-19", "2026-06-21"], ["中秋节", "2026-09-25", "2026-09-27"],
  ["国庆节", "2026-10-01", "2026-10-07"],
] as const;
export const chinaHolidays = ranges.flatMap(([name, start, end]) => {
  const days: { date: string; name: string }[] = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86400000) days.push({ date: new Date(time).toISOString().slice(0, 10), name });
  return days;
});
export const chinaMakeupWorkdays = ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"];
export const holidayBusyWindows = chinaHolidays.map(day => ({ start: `${day.date}T00:00:00+08:00`, end: new Date(Date.parse(`${day.date}T00:00:00+08:00`) + 86400000).toISOString() }));
