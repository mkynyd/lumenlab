"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated bank scan assets. */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StudySelect, StudyCheck } from "./controls";
import { Input } from "@/components/ui/input";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { cn } from "@/lib/utils";
type Paper = {
  id: string;
  title: string;
  year: number;
  subject: string;
  exam: string;
  sourceUrl: string;
  license: string;
};
type Question = {
  id: string;
  ordinal: string;
  prompt: string;
  assets: string[];
};
async function read<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init),
    data = await response.json();
  if (!response.ok) throw new Error(data.error || "题库读取失败");
  return data;
}
export function BankBrowser({
  notebookId,
  onSelected,
  onClose,
}: {
  notebookId: string;
  onSelected: (jobId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [stage, setStage] = useState("all");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void read<{ papers: Paper[] }>("/api/study/bank/papers")
      .then((data) => {
        if (active) setPapers(data.papers);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  async function open(selected: Paper, after?: string) {
    const result = await read<{
      questions: Question[];
      nextCursor: string | null;
    }>(
      `/api/study/bank/papers/${selected.id}${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    );
    setPaper(selected);
    setQuestions((previous) =>
      after ? [...previous, ...result.questions] : result.questions,
    );
    setCursor(result.nextCursor);
    if (!after) setChosen([]);
  }
  return (
    <section
      className="space-y-4 rounded-xl bg-[var(--color-surface-hover)] p-5"
      aria-label="从题库选题"
    >
      <header className="flex justify-between">
        <h2 className="font-semibold">从题库选择错题</h2>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          关闭
        </Button>
      </header>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const query = new URLSearchParams();
          for (const key of ["stage", "subject", "exam", "year"]) {
            const value = String(form.get(key) ?? "");
            if (value && value !== "all") query.set(key, value);
          }
          void action(async () => {
            const data = await read<{ papers: Paper[] }>(
              `/api/study/bank/papers?${query}`,
            );
            setPapers(data.papers);
            setPaper(null);
          });
        }}
      >
        <StudySelect
          name="stage"
          label="题库学习阶段"
          className="w-full sm:w-40"
          value={stage}
          onChange={setStage}
          options={[
            { value: "all", label: "所有阶段" },
            { value: "university", label: "大学" },
            { value: "secondary", label: "中学" },
            { value: "primary", label: "小学" },
            { value: "professional", label: "资格考试" },
            { value: "other", label: "其他" },
          ]}
        />
        <Input
          name="subject"
          className="w-32"
          aria-label="题库学科"
          placeholder="学科"
        />
        <Input
          name="exam"
          className="w-40"
          aria-label="题库考试"
          placeholder="例如：考研数学二"
        />
        <Input
          name="year"
          className="w-24"
          type="number"
          min={1900}
          max={2200}
          aria-label="题库年份"
          placeholder="年份"
        />
        <Button type="submit" variant="secondary" disabled={busy}>
          筛选
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!paper && (
        <div className="grid gap-3 sm:grid-cols-2">
          {papers.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="space-y-2 rounded-xl bg-[var(--color-surface)] p-4 text-left"
              disabled={busy}
              onClick={() => void action(() => open(candidate))}
            >
              <p className="font-medium">{candidate.title}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {candidate.year} · {candidate.subject} · {candidate.exam}
              </p>
            </button>
          ))}
        </div>
      )}
      {!paper && !papers.length && (
        <p className="py-6 text-sm text-[var(--color-text-secondary)]">
          目前没有符合条件的已核验试卷。也可以上传自己的试卷选择错题。
        </p>
      )}
      {paper && (
        <>
          <div className="space-y-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setPaper(null)}
            >
              返回试卷列表
            </Button>
            <h3 className="font-medium">{paper.title}</h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              来源：
              <a
                className="text-[var(--color-accent)]"
                href={paper.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                原始资料
              </a>{" "}
              · {paper.license}
            </p>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-auto">
            {questions.map((question) => (
              <section
                key={question.id}
                className={cn(
                  "space-y-3 rounded-xl p-4",
                  chosen.includes(question.id)
                    ? "bg-[var(--color-accent-muted)]"
                    : "bg-[var(--color-surface)]",
                )}
              >
                <StudyCheck
                  checked={chosen.includes(question.id)}
                  disabled={
                    busy ||
                    (!chosen.includes(question.id) && chosen.length >= 100)
                  }
                  onChange={(checked) =>
                    setChosen((previous) =>
                      checked
                        ? [...previous, question.id]
                        : previous.filter((id) => id !== question.id),
                    )
                  }
                >
                  选择第 {question.ordinal} 题
                </StudyCheck>
                <MarkdownContent content={question.prompt} />
                {question.assets.map((url, index) => (
                  <img
                    key={url}
                    src={url}
                    alt={`第${question.ordinal}题插图${index + 1}`}
                    className="max-h-96 max-w-full"
                  />
                ))}
              </section>
            ))}
          </div>
          {cursor && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void action(() => open(paper, cursor))}
            >
              加载更多题目
            </Button>
          )}
          <Button
            disabled={busy || !chosen.length}
            onClick={() =>
              void action(async () => {
                const result = await read<{ jobId: string | null }>(
                  "/api/study/bank/select",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ notebookId, questionIds: chosen }),
                  },
                );
                await onSelected(result.jobId);
              })
            }
          >
            将 {chosen.length} 道错题加入错题本
          </Button>
        </>
      )}
    </section>
  );
}
