"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock,
  Plus,
  Upload,
  WandSparkles,
  CalendarClock,
  FileText,
} from "lucide-react";
import { zhCN } from "react-day-picker/locale";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StudyDateTime } from "./controls";
import { StudyContext, StudyMore } from "./actions";
import { TimetableImport } from "./timetable-import";
import { TaskExtractor } from "./task-extractor";
import { SchoolAdjustments } from "./school-adjustments";
import { StudyPlanning } from "./planning";
import {
  calendarDate,
  chinaDateKey,
  type CalendarEvent,
  type Task,
} from "./types";
import { chinaHolidays, chinaMakeupWorkdays } from "@/lib/study/holidays";

const TOOLS = [
  {
    id: "task",
    label: "新增任务",
    description: "输入作业与截止时间",
    icon: Plus,
  },
  {
    id: "timetable",
    label: "导入课表",
    description: "图片、Excel、ICS 或 PDF",
    icon: Upload,
  },
  {
    id: "extract",
    label: "识别老师要求",
    description: "粘贴文字或上传要求",
    icon: FileText,
  },
  {
    id: "planning",
    label: "规划学习时间",
    description: "安排空闲时段，避开课程",
    icon: WandSparkles,
  },
  {
    id: "adjust",
    label: "补课与休息",
    description: "登记学校调课和忙碌时间",
    icon: CalendarClock,
  },
] as const;

export function ScheduleWorkspace({
  tasks,
  events,
  busy,
  onApplied,
  onCreateTask,
  onComplete,
  onRemoveEvent,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  busy: boolean;
  onApplied: () => Promise<void>;
  onCreateTask: (data: {
    title: string;
    deadline: string;
    estimatedMinutes: number;
  }) => Promise<void>;
  onComplete: (task: Task) => void;
  onRemoveEvent: (event: CalendarEvent) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    () => new Date(),
  );
  const [tool, setTool] = useState<(typeof TOOLS)[number]["id"] | null>(null);
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const remaining = tasks
    .filter((task) => !task.completed)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const visibleTasks = showCompleted
    ? tasks
        .filter((t) => t.completed)
        .sort((a, b) => a.deadline.localeCompare(b.deadline))
    : remaining;
  const dayEvents = events.filter(
    (event) =>
      !selectedDate ||
      chinaDateKey(event.start) === format(selectedDate, "yyyy-MM-dd"),
  );
  const activeTool = TOOLS.find((t) => t.id === tool);
  const open = (id: typeof tool) => {
    setTool(id);
    setError("");
    setDeadline("");
  };
  return (
    <section
      className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]"
      aria-label="学习日程工作区"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <section className="rounded-2xl bg-[var(--color-surface-hover)] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarDays className="size-5 text-[var(--color-accent)]" />
              课程与截止日期
            </h2>
            <Button
              variant="secondary"
              onClick={() => setSelectedDate(new Date())}
            >
              回到今天
            </Button>
          </div>
          <div className="grid items-start gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
            <Calendar
              locale={zhCN}
              weekStartsOn={1}
              captionLayout="label"
              modifiers={{
                deadline: remaining.map((task) => calendarDate(task.deadline)),
                holiday: chinaHolidays.map(
                  (day) => new Date(`${day.date}T00:00:00`),
                ),
                makeup: chinaMakeupWorkdays.map(
                  (day) => new Date(`${day}T00:00:00`),
                ),
                course: events.map((event) => calendarDate(event.start)),
              }}
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              className="w-full bg-[var(--color-surface)] [--cell-size:2.4rem]"
              modifiersClassNames={{
                holiday: "text-[var(--color-accent)]",
                makeup: "italic",
                deadline: "bg-[var(--color-accent-muted)] font-semibold",
                course:
                  "underline decoration-[var(--color-accent)] underline-offset-4",
              }}
            />
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {selectedDate ? format(selectedDate, "M月d日") : "全部日期"}
                  的日程
                </h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {dayEvents.length} 项
                </span>
              </div>
              {!dayEvents.length && (
                <div className="rounded-xl bg-[var(--color-surface)] p-5 text-sm leading-6 text-[var(--color-text-secondary)]">
                  这一天没有安排。导入课表后，课程会显示在这里。
                </div>
              )}
              <div className="flex max-h-72 flex-col gap-2 overflow-auto">
                {dayEvents.map((event) => {
                  const actions = [
                    {
                      label: "移除此日程",
                      destructive: true,
                      disabled: busy,
                      onSelect: () => onRemoveEvent(event),
                    },
                  ];
                  return (
                    <StudyContext key={event.id} actions={actions}>
                      <article className="flex gap-3 rounded-xl bg-[var(--color-surface)] p-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium">
                            {event.title}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                            {event.kind === "course"
                              ? "课程"
                              : event.kind === "busy"
                                ? "忙碌时段"
                                : "学习安排"}{" "}
                            ·{" "}
                            {new Date(event.start).toLocaleTimeString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            –
                            {new Date(event.end).toLocaleTimeString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <StudyMore label={event.title} actions={actions} />
                      </article>
                    </StudyContext>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-[var(--color-text-secondary)]">
            高亮：任务截止 · 下划线：已有日程 · 彩色：2026 法定放假 ·
            斜体：调休工作日
          </p>
        </section>
        <section className="flex flex-col gap-3" aria-label="截止任务">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {showCompleted ? "已完成任务" : "剩余任务"}{" "}
                <span className="ml-2 text-sm font-normal text-[var(--color-text-secondary)]">
                  {visibleTasks.length} 项
                </span>
              </h2>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                按截止时间从近到远排列 · 北京时间
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => setShowCompleted(!showCompleted)}
            >
              {showCompleted ? "查看剩余任务" : "查看已完成"}
            </Button>
          </div>
          {visibleTasks.map((task) => {
            const overdue =
              !task.completed && new Date(task.deadline).getTime() < now;
            const actions = [
              {
                label: task.completed ? "恢复为未完成" : "标记完成",
                disabled: busy,
                onSelect: () => onComplete(task),
              },
            ];
            return (
              <StudyContext key={task.id} actions={actions}>
                <article className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-hover)] p-4">
                  <span className="hidden size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-accent)] sm:flex">
                    {task.completed ? (
                      <Check className="size-4" />
                    ) : (
                      <Clock className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">
                      {task.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                      {new Date(task.deadline).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · 预计 {task.estimatedMinutes} 分钟
                      {overdue && (
                        <span className="ml-2 text-destructive">已逾期</span>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onComplete(task)}
                    className="h-9 bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                  >
                    {task.completed ? (
                      "恢复"
                    ) : (
                      <>
                        <Check />
                        完成
                      </>
                    )}
                  </Button>
                  <StudyMore label={task.title} actions={actions} />
                </article>
              </StudyContext>
            );
          })}
          {!visibleTasks.length && (
            <div className="rounded-xl bg-[var(--color-surface-hover)] p-6 text-sm text-[var(--color-text-secondary)]">
              {showCompleted
                ? "还没有已完成任务。"
                : "没有待完成任务，可以添加下一项作业。"}
            </div>
          )}
        </section>
      </div>
      <aside className="flex flex-col gap-4">
        <div>
          <h2 className="font-semibold">安排学习</h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            任务、课表与空闲时间放在一起。
          </p>
        </div>
        {TOOLS.map(({ id, label, description, icon: Icon }) => (
          <Button
            key={id}
            variant={id === "task" ? "default" : "secondary"}
            className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left"
            onClick={() => open(id)}
          >
            <Icon className="size-5" />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-1 block text-xs font-normal opacity-80">
                {description}
              </span>
            </span>
          </Button>
        ))}
        <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
          右键任务或日程可快速操作；触屏可使用每行的更多按钮。
        </p>
      </aside>
      <Dialog
        open={!!tool}
        onOpenChange={(isOpen) => {
          if (!isOpen && !saving) setTool(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{activeTool?.label}</DialogTitle>
            <DialogDescription>
              {activeTool?.description}。日期与时间均按北京时间保存。
            </DialogDescription>
          </DialogHeader>
          {tool === "task" && (
            <form
              className="flex flex-col gap-5"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget,
                  data = new FormData(form);
                if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)) {
                  setError("请选择截止日期和时间");
                  return;
                }
                setSaving(true);
                setError("");
                try {
                  await onCreateTask({
                    title: String(data.get("title")),
                    deadline: `${deadline}:00+08:00`,
                    estimatedMinutes: Number(data.get("minutes")),
                  });
                  setTool(null);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "保存失败");
                } finally {
                  setSaving(false);
                }
              }}
            >
              <label className="flex flex-col gap-2 text-sm">
                任务名称
                <Input
                  name="title"
                  aria-label="任务名称"
                  placeholder="例如：完成实验报告"
                  required
                  maxLength={200}
                />
              </label>
              <div className="flex flex-col gap-2 text-sm">
                截止日期与时间
                <StudyDateTime
                  value={deadline}
                  onChange={setDeadline}
                  label="任务截止"
                  disabled={saving}
                />
              </div>
              <label className="flex flex-col gap-2 text-sm">
                预计耗时（分钟）
                <Input
                  type="number"
                  name="minutes"
                  defaultValue={60}
                  min={5}
                  max={100000}
                  step={5}
                  required
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button className="h-10" disabled={saving} type="submit">
                {saving ? "正在保存…" : "添加任务"}
              </Button>
            </form>
          )}
          {tool === "timetable" && <TimetableImport onApplied={onApplied} />}
          {tool === "extract" && <TaskExtractor onApplied={onApplied} />}
          {tool === "adjust" && <SchoolAdjustments onApplied={onApplied} />}
          {tool === "planning" && <StudyPlanning onApplied={onApplied} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
