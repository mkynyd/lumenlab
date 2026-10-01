export interface TimeWindow { start: string; end: string }
export interface PlanningTask { id: string; deadline: string; remainingMinutes: number }
export interface PlannedBlock { taskId: string; start: string; end: string }

function interval(window: TimeWindow): [number, number] {
  const start = Date.parse(window.start), end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("时间区间无效");
  }
  return [start, end];
}

/** Earliest-deadline allocation; only explicit availability can be scheduled. */
export function planStudyTime(input: {
  tasks: PlanningTask[];
  availability: TimeWindow[];
  busy: TimeWindow[];
  now: string;
  blockMinutes?: number;
}) {
  const now = Date.parse(input.now);
  const blockMinutes = input.blockMinutes ?? 45;
  if (!Number.isFinite(now) || !Number.isInteger(blockMinutes) || blockMinutes < 5 || blockMinutes > 180) {
    throw new Error("排程参数无效");
  }
  if (new Set(input.tasks.map(t => t.id)).size !== input.tasks.length) throw new Error("任务标识重复");
  const busy = input.busy.map(interval);
  const merged: [number, number][] = [];
  for (const [start, end] of input.availability.map(interval).sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let free: [number, number][] = merged.filter(([, end]) => end > now).map(([start, end]) => [Math.max(start, now), end]);
  for (const [busyStart, busyEnd] of busy) {
    free = free.flatMap(([start, end]): [number, number][] => {
      if (busyEnd <= start || busyStart >= end) return [[start, end]];
      const parts: [number, number][] = [];
      if (busyStart > start) parts.push([start, busyStart]);
      if (busyEnd < end) parts.push([busyEnd, end]);
      return parts;
    });
  }
  const blocks: PlannedBlock[] = [];
  const unscheduled: { taskId: string; minutes: number }[] = [];
  const tasks = input.tasks.map(task => {
    const deadline = Date.parse(task.deadline);
    if (!Number.isFinite(deadline) || !Number.isInteger(task.remainingMinutes) || task.remainingMinutes < 0) {
      throw new Error("任务期限或工作量无效");
    }
    return { ...task, deadlineMs: deadline };
  }).sort((a, b) => a.deadlineMs - b.deadlineMs || a.id.localeCompare(b.id));
  for (const task of tasks) {
    let remaining = task.remainingMinutes;
    for (let i = 0; i < free.length && remaining > 0; i++) {
      const slot = free[i];
      while (remaining > 0) {
        const availableMinutes = Math.floor((Math.min(slot[1], task.deadlineMs) - slot[0]) / 60000);
        if (availableMinutes < Math.min(5, remaining)) break;
        const minutes = Math.min(blockMinutes, remaining, availableMinutes);
        const end = slot[0] + minutes * 60000;
        blocks.push({ taskId: task.id, start: new Date(slot[0]).toISOString(), end: new Date(end).toISOString() });
        slot[0] = end;
        remaining -= minutes;
      }
    }
    if (remaining > 0) unscheduled.push({ taskId: task.id, minutes: remaining });
  }
  return { blocks, unscheduled, feasible: unscheduled.length === 0 };
}
