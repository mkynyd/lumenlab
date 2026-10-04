"use client";
import { StudyFeedback } from "./controls";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  StudyDatePicker,
  StudyTimePicker,
  StudyCheck,
  UploadButton,
} from "./controls";
import {
  periodSchema,
  expandTimetable,
  type CoursePattern,
  type CourseEvent,
} from "@/lib/study/timetable";
type Preview = {
  patterns: CoursePattern[];
  events: CourseEvent[];
  warnings: string[];
};
export function TimetableImport({
  onApplied,
}: {
  onApplied: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [periods, setPeriods] = useState<
    { number: number; start: string; end: string }[]
  >([]);
  const [termStart, setTermStart] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [replace, setReplace] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let expanded: CourseEvent[] = [];
  let timingError = "";
  if (preview?.patterns.length && termStart) {
    try {
      expanded = expandTimetable({
        patterns: preview.patterns,
        termStart,
        periods,
      });
    } catch (cause) {
      timingError = cause instanceof Error ? cause.message : "请补全节次时间";
    }
  }
  const events = [...(preview?.events ?? []), ...expanded];
  async function upload(file: File) {
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      const form = new FormData();
      form.set("file", file);
      if (rangeStart) form.set("start", `${rangeStart}T00:00:00+08:00`);
      if (rangeEnd) form.set("end", `${rangeEnd}T00:00:00+08:00`);
      const response = await fetch("/api/study/timetable/preview", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "课表识别失败");
      const data = result as Preview;
      setPreview(data);
      let savedPeriods: { number: number; start: string; end: string }[] = [];
      if (data.patterns.length) {
        try {
          const response = await fetch("/api/study/preferences");
          if (response.ok) {
            const { preferences } = await response.json();
            const parsed = periodSchema.array().safeParse(preferences?.periods);
            if (parsed.success) savedPeriods = parsed.data;
            if (preferences?.termStart)
              setTermStart(
                new Intl.DateTimeFormat("sv-SE", {
                  timeZone: "Asia/Shanghai",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                }).format(new Date(preferences.termStart)),
              );
          }
        } catch {
          /* Unavailable preferences leave explicit blank fields. */
        }
      }
      setPeriods(
        [...new Set(data.patterns.flatMap((pattern) => pattern.periods))]
          .sort((a, b) => a - b)
          .map(
            (number) =>
              savedPeriods.find((period) => period.number === number) ?? {
                number,
                start: "",
                end: "",
              },
          ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "课表识别失败");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview || timingError || !events.length || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/study/timetable/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...preview,
          warnings: undefined,
          termStart,
          periods,
          replace,
          confirmed,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存课表失败");
      setPreview(null);
      await onApplied();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存课表失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-4 rounded-xl bg-[var(--color-surface-hover)] p-4"
      aria-label="导入课表"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="sr-only">ICS导入范围起点</span>
          <StudyDatePicker
            label="ICS导入范围起点"
            value={rangeStart}
            onChange={setRangeStart}
            disabled={busy}
          />
        </label>
        <label className="text-xs">
          <span className="sr-only">ICS导入范围终点（不含当天）</span>
          <StudyDatePicker
            label="ICS导入范围终点"
            value={rangeEnd}
            onChange={setRangeEnd}
            disabled={busy}
          />
        </label>
      </div>
      <UploadButton
        label="选择课表文件"
        busyLabel="正在处理课表…"
        accept="image/*,.xlsx,.xls,.ics,.pdf"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      {error && <StudyFeedback message={error} error />}
      {preview && (
        <div className="space-y-4">
          {preview.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-destructive">
              {preview.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          {preview.patterns.length > 0 && (
            <>
              <label className="block text-xs">
                <span className="sr-only">第1周星期一日期</span>
                <StudyDatePicker
                  label="第1周星期一日期"
                  value={termStart}
                  onChange={(value) => {
                    setTermStart(value);
                    setConfirmed(false);
                  }}
                  disabled={busy}
                />
              </label>
              <div className="flex flex-col gap-2">
                {periods.map((period, index) => (
                  <div
                    key={period.number}
                    className="grid grid-cols-[45px_1fr_1fr] items-center gap-2 text-xs"
                  >
                    <span>第{period.number}节</span>
                    {(["start", "end"] as const).map((key) => (
                      <StudyTimePicker
                        key={key}
                        label={`第${period.number}节${key === "start" ? "开始" : "结束"}`}
                        value={period[key]}
                        disabled={busy}
                        onChange={(clock) => {
                          setPeriods((previous) =>
                            previous.map((value, i) =>
                              i === index ? { ...value, [key]: clock } : value,
                            ),
                          );
                          setConfirmed(false);
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="max-h-48 space-y-2 overflow-auto text-xs">
                {preview.patterns.map((pattern, index) => (
                  <p key={index}>
                    {pattern.title} · 星期{pattern.weekday} · 第
                    {pattern.weeks.join("、")}周 · 第
                    {pattern.periods.join("、")}节 · {pattern.location}
                  </p>
                ))}
              </div>
            </>
          )}
          {timingError && <StudyFeedback message={timingError} error />}
          <p className="text-sm font-medium">{events.length} 次课程</p>
          <div className="max-h-64 space-y-2 overflow-auto text-xs">
            {events.map((event, index) => (
              <p key={index}>
                {event.title} ·{" "}
                {new Date(event.start).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}{" "}
                —{" "}
                {new Date(event.end).toLocaleTimeString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {event.location}
              </p>
            ))}
          </div>
          <StudyCheck checked={replace} onChange={setReplace} disabled={busy}>
            替换之前导入的课程
          </StudyCheck>
          <StudyCheck
            hint="检查课程、周次、节次时间与识别提示，确认后导入；学校调课以学校通知为准。"
            checked={confirmed}
            onChange={setConfirmed}
            disabled={busy}
          >
            确认课表
          </StudyCheck>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              取消
            </Button>
            <Button
              disabled={busy || !confirmed || !events.length || !!timingError}
              onClick={() => void apply()}
            >
              确认导入
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
