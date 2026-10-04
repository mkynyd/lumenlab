"use client";
import { StudyFeedback } from "@/components/study/controls";

// Adapted from the licensed ReactBits Pro onboarding-2 vertical-step form.
import { useState } from "react";
import { Check, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudySelect, UploadButton } from "@/components/study/controls";
import { Input } from "@/components/ui/input";
import { collectionSchema, type CollectionInput } from "@/lib/study/contracts";
import { StudyTip } from "@/components/study/controls";
const STEPS = [
  { title: "学习阶段", description: "选择年级与学习阶段" },
  { title: "学科与考试", description: "明确这本题集的范围" },
  { title: "考试大纲", description: "用于自动识别题目考点" },
  { title: "题集与错题本", description: "只收录你选择的错题" },
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
  ) => (
    <label className="block space-y-2 text-sm">
      <span className="sr-only">{label}</span>
      <Input
        aria-label={label}
        value={form[key]}
        onChange={(event) => field(key, event.target.value)}
        placeholder={label}
        maxLength={key === "subject" ? 80 : 100}
        disabled={busy}
      />
    </label>
  );
  return (
    <section
      className="grid min-h-[480px] overflow-hidden rounded-2xl bg-[var(--color-surface)] md:grid-cols-[220px_1fr]"
      aria-label="创建题集"
    >
      <aside className="bg-[var(--color-surface-hover)] p-5">
        <ol className="grid grid-cols-4 gap-2 md:grid-cols-1">
          {STEPS.map((item, index) => (
            <li key={item.title}>
              <StudyTip content={item.description}>
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
                  <span className="hidden md:block">{item.title}</span>
                </Button>
              </StudyTip>
            </li>
          ))}
        </ol>
      </aside>
      <form
        className="flex min-w-0 flex-col p-6 md:p-8"
        onSubmit={(event) => {
          event.preventDefault();
          void next();
        }}
      >
        <div className="mb-6 flex-1 space-y-5">
          {step === 0 && (
            <>
              <label className="block space-y-2 text-sm">
                <span className="sr-only">学习阶段</span>
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
              {textField("grade", "年级（选填）")}
            </>
          )}
          {step === 1 && (
            <>
              {textField("subject", "学科")}
              {textField("major", "专业（选填）")}
              {textField("exam", "考试（选填）")}
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
              <label className="block space-y-2 text-sm">
                <span className="sr-only">考试大纲或知识范围（选填）</span>
                <textarea
                  className="min-h-40 w-full rounded-md bg-[var(--color-surface-hover)] p-3"
                  value={form.syllabus}
                  onChange={(event) => field("syllabus", event.target.value)}
                  placeholder="大纲 / 知识范围"
                  maxLength={100000}
                />
              </label>
            </>
          )}
          {step === 3 && (
            <>
              {textField("name", "题集名称")}
              {textField("notebookName", "第一本错题本")}
            </>
          )}
        </div>
        {error && <StudyFeedback message={error} error />}
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
