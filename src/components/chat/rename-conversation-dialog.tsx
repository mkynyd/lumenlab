"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRenameConversation } from "@/lib/hooks/use-conversations";
import { errorMessage } from "@/lib/api/client";

interface RenameConversationTarget {
  id: string;
  title: string;
}

interface RenameConversationDialogProps {
  conversation: RenameConversationTarget | null;
  onOpenChange: (open: boolean) => void;
}

/** 会话标题的手动重命名入口；保存后标题生成不会再覆盖。 */
export function RenameConversationDialog({
  conversation,
  onOpenChange,
}: RenameConversationDialogProps) {
  return (
    <Dialog open={conversation !== null} onOpenChange={onOpenChange}>
      {conversation ? (
        <RenameConversationForm
          key={conversation.id}
          conversation={conversation}
          onCancel={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function RenameConversationForm({
  conversation,
  onCancel,
}: {
  conversation: RenameConversationTarget;
  onCancel: () => void;
}) {
  const renameMutation = useRenameConversation();
  const [title, setTitle] = useState(conversation.title);
  const [error, setError] = useState<string | null>(null);
  const trimmed = title.replace(/\s+/g, " ").trim();
  const canSubmit =
    Boolean(trimmed) && trimmed !== conversation.title && !renameMutation.isPending;

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    try {
      await renameMutation.mutateAsync({
        id: conversation.id,
        title: trimmed,
      });
      onCancel();
    } catch (renameError) {
      setError(errorMessage(renameError, "重命名失败，请稍后重试"));
    }
  }

  return (
    <DialogContent className="max-w-md" showCloseButton>
      <DialogHeader>
        <DialogTitle>重命名对话</DialogTitle>
        <DialogDescription>
          给这段对话一个更容易识别的标题，保存后不会再被自动标题覆盖。
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={40}
          autoFocus
          aria-label="对话标题"
          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus-visible:border-[var(--color-accent)]"
        />
        {error && (
          <p role="alert" className="text-xs text-[var(--color-error)]">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={renameMutation.isPending}
          >
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {renameMutation.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
