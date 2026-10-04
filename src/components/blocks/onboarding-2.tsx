"use client";

// Adapted from the licensed ReactBits Pro onboarding-2 vertical-step form.
import { useState } from "react";
import { Check, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudySelect, UploadButton } from "@/components/study/controls";
import { Input } from "@/components/ui/input";
import { collectionSchema, type CollectionInput } from "@/lib/study/contracts";
const STEPS = [
  { title: "学习阶段", description: "选择学段和年级，用于整理题集与筛选题库。" },
  { title: "学科与考试", description: "填写学科；专业和考试名称可选。" },
  { title: "考试大纲", description: "上传或粘贴考试范围，用于标注题目考点。没有大纲也可以继续。" },
  { title: "题集与错题本", description: "命名题集和第一本错题本，创建后再上传或从题库选题。" },
];
export default function Onboarding2({
  onCreate,
  onCancel,
}: {
  onCreate: (input: CollectionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<CollectionInput>({
    name: "",
    stage: "university",
    grade: "",
    subject: "",
    major: "",
    exam: "",
    syllabus: "",
    notebookName: "错题本",
  });
  function field(key: keyof CollectionInput, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  async function next() {
    setError("");
    if (step === 1 && !form.subject.trim()) {
      setError("请填写学科");
      return;
    }
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    const parsed = collectionSchema.safeParse(form);
    if (!parsed.success) {
      setError("请填写题集名称、学科和错题本名称");
      return;
    }
    setBusy(true);
    try {
      await onCreate(parsed.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  const textField = (
    key: "name" | "grade" | "subject" | "major" | "exam" | "notebookName",
    label: string,
    placeholder: string,
  ) => (
    <label className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        aria-label={label}
        value={form[key]}
        onChange={(event) => field(key, event.target.value)}
        placeholder={placeholder}
        maxLength={key === "subject" ? 80 : 100}
        disabled={busy}
      />
    </label>
  );
  return (
    <section
      className="flex flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)] md:grid md:min-h-[480px] md:grid-cols-[220px_1fr]"
      aria-label="创建题集"
    >
      <aside className="flex flex-col gap-4 bg-[var(--color-surface-hover)] p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">创建题集</h2>
          <span className="text-xs text-[var(--color-text-secondary)]">{step + 1} / 4</span>
        </div>
        <ol aria-label="创建步骤" className="grid grid-cols-2 gap-2 md:grid-cols-1">
          {STEPS.map((item, index) => (
            <li key={item.title}>
              <Button
                type="button"
                variant={index === step ? "default" : "secondary"}
                disabled={busy || index > step}
                aria-label={item.title}
                aria-current={index === step ? "step" : undefined}
                className="h-auto min-h-11 w-full justify-start whitespace-normal p-3 text-left"
                onClick={() => setStep(index)}
              >
                <span className="shrink-0">
                  {index < step ? <Check size={14} /> : index + 1}
                </span>
                <span className="text-xs leading-5 sm:text-sm">{item.title}</span>
              </Button>
            </li>
          ))}
        </ol>
      </aside>
      <form
        className="flex min-w-0 flex-col p-5 md:p-8"
        onSubmit={(event) => {
          event.preventDefault();
          void next();
        }}
      >
        <div className="mb-6 flex flex-1 flex-col gap-5">
          <header className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold">{STEPS[step].title}</h3>
            <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{STEPS[step].description}</p>
          </header>
          {step === 0 && (
            <>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">学习阶段</span>
                <StudySelect
                  label="学习阶段"
                  value={form.stage}
                  onChange={(value) => field("stage", value)}
                  disabled={busy}
                  options={[
                    { value: "primary", label: "小学" },
                    { value: "secondary", label: "中学" },
                    { value: "university", label: "大学" },
                    { value: "professional", label: "职业 / 资格考试" },
                    { value: "other", label: "其他" },
                  ]}
                />
              </label>
              {textField("grade", "年级（选填）", "例如：大三")}
            </>
          )}
          {step === 1 && (
            <>
              {textField("subject", "学科", "例如：数学、英语、数据结构")}
              {textField("major", "专业（选填）", "例如：计算机科学与技术")}
              {textField("exam", "考试（选填）", "例如：考研数学二、大学英语六级")}
            </>
          )}
          {step === 2 && (
            <>
              <div className="flex flex-col gap-2 text-sm">
                <UploadButton
                  label="选择大纲文件"
                  accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.md,.markdown,.txt"
                  disabled={busy}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setBusy(true);
                    setError("");
                    try {
                      const data = new FormData();
                      data.set("mode", "syllabus");
                      data.set("file", file);
                      const response = await fetch("/api/study/extract", {
                          method: "POST",
                          body: data,
                        }),
                        result = await response.json();
                      if (!response.ok) throw new Error(result.error);
                      field("syllabus", result.text);
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : "识别失败",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </div>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">考试大纲或知识范围（选填）</span>
                <textarea
                  aria-label="考试大纲或知识范围（选填）"
                  className="min-h-40 w-full rounded-md bg-[var(--color-surface-hover)] p-3"
                  value={form.syllabus}
                  onChange={(event) => field("syllabus", event.target.value)}
                  placeholder="例如：极限、导数、一元函数积分；或粘贴完整大纲"
                  maxLength={100000}
                />
              </label>
            </>
          )}
          {step === 3 && (
            <>
              {textField("name", "题集名称", "例如：2027 考研数学二")}
              {textField("notebookName", "第一本错题本", "例如：极限与连续")}
            </>
          )}
        </div>
        {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </Button>
          {step > 0 && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft />
              上一步
            </Button>
          )}
          <Button className="ml-auto h-10 px-4" type="submit" disabled={busy}>
            {busy ? "正在处理…" : step === 3 ? "创建题集" : "下一步"}
            {!busy && step < 3 && <ArrowRight />}
          </Button>
        </div>
      </form>
    </section>
  );
}
