"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StudySelect, StudyDateTime } from "./controls";
import { Input } from "@/components/ui/input";
export function SchoolAdjustments({
  onApplied,
}: {
  onApplied: () => Promise<void>;
}) {
  const [kind, setKind] = useState("course"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="space-y-3 rounded-xl bg-[var(--color-surface-hover)] p-4">
      <h2 className="font-medium">学校补课与不可用时段</h2>
      <p className="text-xs text-[var(--color-text-secondary)]">
        按学校通知添加补课、考试或休息时段。停课可在日历日程列表中移除对应课程。
      </p>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget,
            data = new FormData(form);
          if (
            !Number.isFinite(new Date(`${start}:00+08:00`).getTime()) ||
            !Number.isFinite(new Date(`${end}:00+08:00`).getTime())
          ) {
            setError("请选择开始和结束日期及时间");
            return;
          }
          if (start >= end) {
            setError("结束须晚于开始");
            return;
          }
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/study/events", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: data.get("title"),
                kind,
                start: `${start}:00+08:00`,
                end: `${end}:00+08:00`,
              }),
            });
            if (!response.ok) throw new Error((await response.json()).error);
            form.reset();
            setStart("");
            setEnd("");
            await onApplied();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          name="title"
          aria-label="补课或占用名称"
          placeholder="例如：国庆调休补课、休息"
          required
          maxLength={200}
        />
        <StudySelect
          label="日程类型"
          value={kind}
          onChange={setKind}
          disabled={busy}
          options={[
            { value: "course", label: "学校课程 / 补课" },
            { value: "busy", label: "不可用 / 休息 / 考试" },
          ]}
        />
        <div className="flex flex-col gap-3">
          <label className="text-xs">
            开始（北京时间）
            <StudyDateTime
              label="日程开始"
              value={start}
              onChange={setStart}
              disabled={busy}
            />
          </label>
          <label className="text-xs">
            结束（北京时间）
            <StudyDateTime
              label="日程结束"
              value={end}
              onChange={setEnd}
              disabled={busy}
            />
          </label>
        </div>
        <Button type="submit" disabled={busy} variant="secondary">
          确认添加日程
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
