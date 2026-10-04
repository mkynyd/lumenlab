"use client";

import { useEffect, useState } from "react";
import {
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
import { StudyDateTime, StudyTip } from "./controls";
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
            <StudyTip content="高亮：截止日期；下划线：已有日程；彩色：2026法定放假；斜体：调休工作日。">
              <Button
                variant="secondary"
                onClick={() => setSelectedDate(new Date())}
              >
                回到今天
              </Button>
            </StudyTip>
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
                  {selectedDate ? format(selectedDate, "M月d日") : ""}
                </h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {dayEvents.length} 项
                </span>
              </div>

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
        </section>
        <section className="flex flex-col gap-3" aria-label="截止任务">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
                      · {task.estimatedMinutes} 分钟
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
            <Button variant="secondary" onClick={() => open("task")}>
              <Plus />
              添加任务
            </Button>
          )}
        </section>
      </div>
      <aside className="flex flex-col gap-4">
        {TOOLS.map(({ id, label, description, icon: Icon }) => (
          <StudyTip key={id} content={description}>
            <Button
              variant={id === "task" ? "default" : "secondary"}
              className="h-12 w-full justify-start gap-3 px-4"
              onClick={() => open(id)}
            >
              <Icon className="size-5" />
              {label}
            </Button>
          </StudyTip>
        ))}
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
                <span>任务名称</span>
                <Input
                  name="title"
                  aria-label="任务名称"
                  placeholder="例如：完成实验报告"
                  required
                  maxLength={200}
                />
              </label>
              <div className="flex flex-col gap-2 text-sm">
                <span>截止日期与时间（北京时间）</span>
                <StudyDateTime
                  value={deadline}
                  onChange={setDeadline}
                  label="任务截止"
                  disabled={saving}
                />
              </div>
              <label className="flex flex-col gap-2 text-sm">
                <span>预计耗时（分钟）</span>
                <Input
                  type="number"
                  name="minutes"
                  aria-label="预计耗时（分钟）"
                  placeholder="预计耗时（分钟）"
                  defaultValue={60}
                  min={5}
                  max={100000}
                  step={5}
                  required
                />
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
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
