"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StudySelect } from "./controls";
import { Input } from "@/components/ui/input";
import { MarkdownContent } from "@/components/markdown/markdown-content";

type Selection = { ordinal: string; ranges: { start: number; end: number }[] };
export function TextSelector({
  source,
  onSubmit,
  onCancel,
}: {
  source: string;
  onSubmit: (questions: Selection[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [questions, setQuestions] = useState<Selection[]>([]),
    [target, setTarget] = useState(-1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="space-y-4 rounded-xl bg-[var(--color-surface-hover)] p-4">
      <h2 className="font-semibold">选择 Markdown 中的错题</h2>
      <p className="text-sm">
        选中下方原文后添加为题目；长文、选项和跨段内容可追加到指定题目。原文只在本次选择中临时使用。
      </p>
      <label className="block text-sm">
        绑定到
        <StudySelect
          label="绑定到指定题目"
          value={String(target)}
          onChange={(value) => setTarget(Number(value))}
          options={[
            { value: "-1", label: "新题目" },
            ...questions.map((question, index) => ({
              value: String(index),
              label: `题目 ${question.ordinal}`,
            })),
          ]}
        />
      </label>
      <textarea
        readOnly
        value={source}
        className="h-80 w-full rounded-md bg-[var(--color-surface)] p-3 font-mono text-sm"
        aria-label="Markdown 原文"
        id="study-markdown-source"
      />
      <Button
        variant="secondary"
        onClick={() => {
          const field = document.getElementById(
            "study-markdown-source",
          ) as HTMLTextAreaElement;
          const start = field.selectionStart,
            end = field.selectionEnd;
          if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            end <= start
          ) {
            setError("请先选中完整题干与选项");
            return;
          }
          setError("");
          setQuestions((previous) =>
            target < 0
              ? [
                  ...previous,
                  {
                    ordinal: String(previous.length + 1),
                    ranges: [{ start, end }],
                  },
                ]
              : previous.map((question, index) =>
                  index === target
                    ? {
                        ...question,
                        ranges: [...question.ranges, { start, end }],
                      }
                    : question,
                ),
          );
        }}
      >
        添加选中文本
      </Button>
      {questions.map((question, index) => (
        <div
          key={index}
          className="space-y-2 rounded-xl bg-[var(--color-surface)] p-4"
        >
          <div className="flex gap-2">
            <Input
              aria-label={`题目${index + 1}的原题号`}
              value={question.ordinal}
              maxLength={80}
              onChange={(event) =>
                setQuestions((previous) =>
                  previous.map((q, i) =>
                    i === index ? { ...q, ordinal: event.target.value } : q,
                  ),
                )
              }
            />
            <Button
              variant="secondary"
              onClick={() => {
                setQuestions((previous) =>
                  previous.filter((_, i) => i !== index),
                );
                setTarget(-1);
              }}
            >
              删除
            </Button>
          </div>
          <MarkdownContent
            resolveImageUrl={() => ""}
            content={question.ranges
              .map((range) => source.slice(range.start, range.end))
              .join("\n\n")}
          />
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          取消并清除原文
        </Button>
        <Button
          disabled={busy || !questions.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSubmit(questions);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "提交失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          仅收录已选 {questions.length} 题
        </Button>
      </div>
    </section>
  );
}
