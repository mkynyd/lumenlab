"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Flag, RefreshCcw, RotateCcw } from "lucide-react"
import { zhCN } from "react-day-picker/locale"

import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { useLearningToday } from "@/lib/hooks/use-learning-today"
import type { LearningTodayResponse } from "@/lib/hooks/use-learning-api"
import { cn } from "@/lib/utils"

type ScheduleKind = "due" | "review" | "target"

interface LearningScheduleItem {
  id: string
  date: Date
  dateKey: string
  kind: ScheduleKind
  label: string
  projectId: string
  projectName: string
  goalId: string
}

const kindPresentation: Record<
  ScheduleKind,
  { label: string; Icon: typeof Flag }
> = {
  due: { label: "到期复习", Icon: RotateCcw },
  review: { label: "计划复习", Icon: RefreshCcw },
  target: { label: "目标日期", Icon: Flag },
}

const selectedDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
})

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function subscribeToTimeZone() {
  return () => {}
}

function readBrowserTimeZone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function readServerTimeZone(): string | undefined {
  return undefined
}

export function buildLearningSchedule(
  data: LearningTodayResponse | undefined
): LearningScheduleItem[] {
  if (!data) return []
  const asOf = validDate(data.asOf) ?? new Date()
  const result: LearningScheduleItem[] = []

  for (const entry of data.goals) {
    const common = {
      projectId: entry.project.id,
      projectName: entry.project.name,
      goalId: entry.goal.id,
    }
    if (entry.summary.due > 0) {
      result.push({
        ...common,
        id: `${entry.goal.id}:due:${dateKey(asOf)}`,
        date: asOf,
        dateKey: dateKey(asOf),
        kind: "due",
        label: `${entry.summary.due} 个知识点待复习`,
      })
    }

    const nextReviewAt = validDate(entry.nextAction.nextReviewAt)
    if (nextReviewAt) {
      result.push({
        ...common,
        id: `${entry.goal.id}:review:${dateKey(nextReviewAt)}`,
        date: nextReviewAt,
        dateKey: dateKey(nextReviewAt),
        kind: "review",
        label: entry.goal.title,
      })
    }

    const targetDate = validDate(entry.goal.targetDate)
    if (targetDate) {
      result.push({
        ...common,
        id: `${entry.goal.id}:target:${dateKey(targetDate)}`,
        date: targetDate,
        dateKey: dateKey(targetDate),
        kind: "target",
        label: entry.goal.title,
      })
    }
  }

  return result.sort((left, right) => left.date.getTime() - right.date.getTime())
}

export interface LearningCalendarProps {
  className?: string
}

/**
 * Month-level learning rhythm. Dots are derived only from persisted Goal and
 * review state; selecting a date reveals a text-equivalent event list.
 */
export function LearningCalendar({ className }: LearningCalendarProps) {
  const todayQuery = useLearningToday()
  const [selected, setSelected] = useState<Date | undefined>(undefined)
  const timeZone = useSyncExternalStore(
    subscribeToTimeZone,
    readBrowserTimeZone,
    readServerTimeZone
  )

  const schedule = useMemo(
    () => buildLearningSchedule(todayQuery.data),
    [todayQuery.data]
  )
  const referenceDate = validDate(todayQuery.data?.asOf) ?? new Date()
  const selectedDate = selected ?? referenceDate
  const selectedKey = dateKey(selectedDate)
  const selectedItems = schedule.filter((item) => item.dateKey === selectedKey)
  const scheduledDates = useMemo(
    () => [...new Map(schedule.map((item) => [item.dateKey, item.date])).values()],
    [schedule]
  )

  return (
    <aside
      aria-labelledby="learning-calendar-title"
      className={cn(
        "flex min-w-0 flex-col rounded-2xl bg-[var(--color-surface-hover)] p-4",
        className
      )}
    >
      <div className="mb-3">
        <h2
          id="learning-calendar-title"
          className="text-sm font-semibold text-[var(--color-text-primary)]"
        >
          学习日历
        </h2>
        <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
          复习安排与目标日期会自动汇总到这里
        </p>
      </div>

      <Calendar
        mode="single"
        selected={selectedDate}
        onSelect={setSelected}
        locale={zhCN}
        timeZone={timeZone}
        modifiers={{ hasLearning: scheduledDates }}
        modifiersClassNames={{
          hasLearning:
            "after:absolute after:bottom-0.5 after:left-1/2 after:z-20 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary after:content-['']",
        }}
        className="mx-auto w-full bg-transparent p-0 [--cell-size:--spacing(9)] sm:[--cell-size:--spacing(10)]"
      />

      <div className="mt-4 min-h-28 rounded-xl bg-[var(--color-surface)] p-3">
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">
          {selectedDateFormatter.format(selectedDate)}
        </p>
        {todayQuery.isPending ? (
          <p role="status" className="mt-3 text-xs text-[var(--color-text-tertiary)]">
            正在读取学习安排…
          </p>
        ) : selectedItems.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {selectedItems.map((item) => {
              const presentation = kindPresentation[item.kind]
              const Icon = presentation.Icon
              return (
                <li key={item.id}>
                  <Button
                    asChild
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2 whitespace-normal px-2 py-2 text-left transition-colors duration-150 motion-reduce:transition-none hover:bg-[var(--color-surface-hover)]"
                  >
                    <Link
                      href={`/learning?project=${encodeURIComponent(item.projectId)}&goal=${encodeURIComponent(item.goalId)}`}
                    >
                      <Icon data-icon="inline-start" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-[var(--color-text-primary)]">
                          {presentation.label} · {item.label}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">
                          {item.projectName}
                        </span>
                      </span>
                    </Link>
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-3 text-xs leading-5 text-[var(--color-text-tertiary)]">
            这一天没有安排。你仍可选择任一项目继续学习。
          </p>
        )}
      </div>
    </aside>
  )
}
