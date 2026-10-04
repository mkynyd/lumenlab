export type Collection = {
  id: string;
  name: string;
  subject: string;
  exam: string;
  notebooks: { id: string; name: string; _count?: { items: number } }[];
};
export type CalendarEvent = {
  id: string;
  title: string;
  kind: string;
  start: string;
  end: string;
};
export type Task = {
  id: string;
  title: string;
  deadline: string;
  estimatedMinutes: number;
  completed: boolean;
};
export const chinaDateKey = (value: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const calendarDate = (value: string) =>
  new Date(`${chinaDateKey(value)}T00:00:00`);
