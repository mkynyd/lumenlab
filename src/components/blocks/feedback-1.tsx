"use client";

import { Bug, Check, Lightbulb, MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type FeedbackKind = "bug" | "suggestion" | "other";
export type FeedbackStatus = "idle" | "success" | "error";

const KINDS = [
  { value: "bug", label: "问题", icon: Bug },
  { value: "suggestion", label: "建议", icon: Lightbulb },
  { value: "other", label: "其他", icon: MessageCircle },
] as const;

const PLACEHOLDERS: Record<FeedbackKind, string> = {
  bug: "发生了什么？你原本期待怎样的结果？",
  suggestion: "你希望增加或改进什么功能？",
  other: "告诉我们你的想法…",
};

/** React Bits Pro Feedback 1，接入 LumenLab 的真实反馈表单和主题。 */
export default function Feedback1({
  kind,
  message,
  contact,
  status,
  submitting,
  onKindChange,
  onMessageChange,
  onContactChange,
  onSubmit,
  onReset,
  onClose,
}: {
  kind: FeedbackKind;
  message: string;
  contact: string;
  status: FeedbackStatus;
  submitting: boolean;
  onKindChange: (kind: FeedbackKind) => void;
  onMessageChange: (message: string) => void;
  onContactChange: (contact: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  if (status === "success") {
    return (
      <div className="px-4 py-9 text-center">
        <span aria-hidden="true" className="mx-auto flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-success-muted)] text-[var(--color-success)]">
          <Check className="size-5" />
        </span>
        <DialogTitle className="mt-4">反馈已发送</DialogTitle>
        <DialogDescription className="mt-2">感谢反馈，我们会尽快查看。</DialogDescription>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button type="button" variant="secondary" onClick={onReset}>再写一条</Button>
          <Button type="button" variant="ghost" onClick={onClose}>关闭</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="flex flex-col gap-3 p-2 sm:p-3">
      <DialogHeader className="flex-row items-start justify-between gap-3 px-1 pt-1">
        <div className="min-w-0">
          <DialogTitle>发送反馈</DialogTitle>
          <DialogDescription className="mt-1 text-xs">问题和建议会直接交给 LumenLab 团队。</DialogDescription>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭反馈" onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </DialogHeader>

      <ToggleGroup
        type="single"
        value={kind}
        onValueChange={(value) => { if (value) onKindChange(value as FeedbackKind); }}
        aria-label="反馈类型"
        spacing={0}
        size="sm"
        className="w-full bg-[var(--color-panel-muted)] p-1"
      >
        {KINDS.map(({ value, label, icon: Icon }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-label={label}
            className="flex-1 border-0 text-[var(--color-text-secondary)] data-[state=on]:bg-[var(--color-panel)] data-[state=on]:text-[var(--color-text-primary)] focus-visible:border-0 focus-visible:ring-0"
          >
            <Icon aria-hidden="true" />{label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex flex-col gap-2">
        <label htmlFor="feedback-content" className="text-xs font-medium text-[var(--color-text-secondary)]">反馈内容</label>
        <Textarea
          id="feedback-content"
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          maxLength={2000}
          rows={4}
          placeholder={PLACEHOLDERS[kind]}
          className="min-h-28 resize-none bg-[var(--color-panel-muted)]"
        />
        <span className="self-end text-xs tabular-nums text-[var(--color-text-tertiary)]" aria-live="polite">{message.length}/2000</span>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="feedback-contact" className="text-xs font-medium text-[var(--color-text-secondary)]">联系方式（选填）</label>
        <Input
          id="feedback-contact"
          value={contact}
          onChange={(event) => onContactChange(event.target.value)}
          maxLength={200}
          placeholder="邮箱或 QQ，方便我们回复"
        />
      </div>

      <p className="rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-3 py-2.5 text-xs leading-5 text-[var(--color-text-tertiary)]">
        会附上当前页面路径和浏览器信息；不会自动采集页面内容或截图。
      </p>

      {status === "error" ? <p role="alert" className="text-xs text-[var(--color-error)]">提交失败，请稍后重试。已保留填写内容。</p> : null}

      <div className="flex justify-end gap-2 pb-1">
        <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
        <Button type="submit" disabled={submitting || !message.trim()}>
          {submitting ? "提交中…" : "发送反馈"}
        </Button>
      </div>
    </form>
  );
}
