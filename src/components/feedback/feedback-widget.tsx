"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus } from "lucide-react";
import Feedback1, { type FeedbackKind, type FeedbackStatus } from "@/components/blocks/feedback-1";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const subscribeToClient = () => () => {};

export function FeedbackWidget() {
  const mounted = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackKind>("bug");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<FeedbackStatus>("idle");
  const submissionVersion = useRef(0);

  function reset() {
    submissionVersion.current += 1;
    setCategory("bug");
    setContent("");
    setContact("");
    setSubmitting(false);
    setStatus("idle");
  }

  async function submit() {
    if (!content.trim() || submitting) return;
    const version = ++submissionVersion.current;
    setSubmitting(true);
    setStatus("idle");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          content: content.trim(),
          contact: contact.trim() || undefined,
          pagePath: window.location.pathname,
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      if (version === submissionVersion.current) {
        setStatus("success");
        setContent("");
        setContact("");
      }
    } catch {
      if (version === submissionVersion.current) setStatus("error");
    } finally {
      if (version === submissionVersion.current) setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      {mounted ? createPortal(
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            aria-label="反馈"
            className={cn("fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-[60] rounded-full shadow-[var(--shadow-pill)] sm:right-6 sm:bottom-6", open && "invisible")}
          >
            <MessageSquarePlus data-icon="inline-start" aria-hidden="true" />反馈
          </Button>
        </DialogTrigger>,
        document.body
      ) : null}
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-2 sm:max-w-[28rem]">
        <Feedback1
          kind={category}
          message={content}
          contact={contact}
          status={status}
          submitting={submitting}
          onKindChange={setCategory}
          onMessageChange={setContent}
          onContactChange={setContact}
          onSubmit={submit}
          onReset={reset}
          onClose={() => { setOpen(false); reset(); }}
        />
      </DialogContent>
    </Dialog>
  );
}
