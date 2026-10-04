"use client";
import { StudyFeedback } from "./controls";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle } from "lucide-react";
import { MarkdownContent } from "@/components/markdown/markdown-content";
export function StudyAssistant({ notebookId }: { notebookId?: string }) {
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<
      { role: "user" | "assistant"; text: string }[]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section>
      <Button
        variant="secondary"
        className="h-10 px-4"
        onClick={() => setOpen(true)}
      >
        <MessageCircle />
        学习助手
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader className="sr-only">
            <DialogTitle>学习助手</DialogTitle>
            <DialogDescription>
              讨论学习范围或安排细节，修改通过页面确认。对话保留在当前页面。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="max-h-80 space-y-4 overflow-auto">
              {messages.map((message, index) => (
                <div key={index}>
                  <MarkdownContent content={message.text} />
                </div>
              ))}
            </div>
            <form
              className="flex flex-col gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget,
                  message = String(new FormData(form).get("message") ?? "");
                setBusy(true);
                setError("");
                try {
                  const response = await fetch("/api/study/assistant", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        message,
                        notebookId,
                        history: messages.slice(-12),
                      }),
                    }),
                    body = await response.json();
                  if (!response.ok) throw new Error(body.error);
                  setMessages((previous) => [
                    ...previous,
                    { role: "user", text: message },
                    { role: "assistant", text: body.reply },
                  ]);
                  form.reset();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "回答失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <textarea
                name="message"
                aria-label="向学习助手提问"
                className="w-full rounded-md bg-[var(--color-surface)] p-3 text-sm"
                placeholder="学习范围 / 日程问题"
                required
                maxLength={10000}
                disabled={busy}
              />
              <Button disabled={busy} type="submit">
                {busy ? "正在思考…" : "发送"}
              </Button>
            </form>
            {error && <StudyFeedback message={error} error />}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
