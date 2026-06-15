"use client";

import { memo, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, User, Bot, Save } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoningContent?: string | null;
  tokenCount?: number | null;
  isStreaming?: boolean;
  onSaveArtifact?: (input: {
    messageId: string;
    title: string;
    type: string;
    content: string;
  }) => Promise<void>;
}

const ARTIFACT_TYPES = [
  ["general", "通用成果"],
  ["experiment_report", "实验报告"],
  ["calculation", "计算过程"],
  ["error_analysis", "误差分析"],
  ["plot_code", "绘图代码"],
  ["review_outline", "复习提纲"],
  ["mock_exam", "模拟试题"],
  ["exam_coverage", "考点索引"],
  ["mistake_explanation", "错题解析"],
  ["quick_memory", "速记卡"],
  ["mermaid", "思维导图"],
  ["code_explanation", "代码说明"],
] as const;

function MessageBubbleComponent({
  id,
  role,
  content,
  reasoningContent,
  tokenCount,
  isStreaming = false,
  onSaveArtifact,
}: MessageBubbleProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [title, setTitle] = useState("AI 成果");
  const [type, setType] = useState("general");
  const [saving, setSaving] = useState(false);
  const isUser = role === "user";
  const isAssistant = role === "assistant";

  const toggleReasoning = useCallback(() => {
    setShowReasoning((prev) => !prev);
  }, []);

  if (!isUser && !isAssistant) return null;

  async function saveArtifact() {
    if (!id || !onSaveArtifact) return;
    setSaving(true);
    try {
      await onSaveArtifact({ messageId: id, title, type, content });
      setShowSave(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] shrink-0 mt-0.5",
          isUser
            ? "bg-[var(--color-accent)] text-white"
            : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
        )}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      <div className={cn("flex-1 min-w-0", isUser && "flex flex-col items-end")}>
        {reasoningContent && (
          <div className="mb-2">
            <button
              onClick={toggleReasoning}
              className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]"
            >
              {showReasoning ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              思考过程
            </button>
            {showReasoning && (
              <div className="mt-1.5 pl-3 border-l-2 border-[var(--color-border)] text-xs whitespace-pre-wrap">
                {reasoningContent}
              </div>
            )}
          </div>
        )}

        <div
          className={cn(
            "text-sm leading-relaxed",
            isUser
              ? "bg-[var(--color-accent-muted)] px-3 py-2 rounded-[var(--radius-md)] max-w-[85%]"
              : "text-[var(--color-text-primary)]"
          )}
        >
          {content ? (
            <div className="prose-sm break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : isStreaming ? (
            <span className="typing-cursor" />
          ) : null}
          {isStreaming && content && <span className="typing-cursor" />}
        </div>

        {isAssistant && onSaveArtifact && id && !isStreaming && content && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowSave((current) => !current)}
              className="flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
            >
              <Save size={12} />
              保存为成果
            </button>
            {showSave && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="h-8 min-w-40 rounded border border-[var(--color-border)] bg-transparent px-2 text-xs"
                  maxLength={150}
                />
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
                >
                  {ARTIFACT_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={saving || !title.trim()}
                  onClick={saveArtifact}
                  className="h-8 rounded bg-[var(--color-accent)] px-3 text-xs text-white disabled:opacity-50"
                >
                  {saving ? "保存中" : "保存"}
                </button>
              </div>
            )}
          </div>
        )}

        {tokenCount != null && (
          <span className="mt-1 text-[10px] font-mono text-[var(--color-text-tertiary)]">
            {tokenCount.toLocaleString()} tokens
          </span>
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(
  MessageBubbleComponent,
  (previous, next) => {
    if (previous.id !== next.id || previous.isStreaming !== next.isStreaming) {
      return false;
    }
    if (next.isStreaming) {
      return (
        previous.content === next.content &&
        previous.reasoningContent === next.reasoningContent
      );
    }
    return (
      previous.content === next.content &&
      previous.reasoningContent === next.reasoningContent &&
      previous.tokenCount === next.tokenCount &&
      previous.onSaveArtifact === next.onSaveArtifact
    );
  }
);
