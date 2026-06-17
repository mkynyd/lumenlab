"use client";

import { memo, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { ChevronDown, ChevronRight, User, Bot, Save } from "lucide-react";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
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
    <div
      className={cn(
        "flex gap-3 px-4 py-4 md:px-6",
        isUser && "flex-row-reverse"
      )}
    >
      <div
        className={cn(
	          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border mt-0.5 shadow-sm",
          isUser
            ? "border-transparent bg-[var(--color-accent)] text-[var(--color-accent-contrast)]"
            : "border-[var(--color-border-light)] bg-[var(--color-panel-muted)] text-[var(--color-text-secondary)]"
        )}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      <div className={cn("flex-1 min-w-0", isUser && "flex flex-col items-end")}>
        {reasoningContent && (
          <div className="mb-2 w-full max-w-[74ch]">
            <button
              onClick={toggleReasoning}
              className="flex items-center gap-1 rounded-[var(--radius-md)] px-1 py-0.5 text-xs text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
              aria-expanded={showReasoning}
            >
              {showReasoning ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              思考过程
            </button>
            {showReasoning && (
              <div className="mt-1.5 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-panel-muted)] px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-[var(--color-text-secondary)]">
                {reasoningContent}
              </div>
            )}
          </div>
        )}

        <div
          className={cn(
            "text-sm",
            isUser
	              ? "max-w-[85%] rounded-[var(--radius-xl)] border border-[var(--color-accent-muted)] bg-[var(--color-accent-soft)] px-3.5 py-2.5 leading-relaxed shadow-[var(--shadow-panel)]"
              : "workbench-readable text-[var(--color-text-primary)]"
          )}
        >
          {content ? (
            <div className="prose-sm break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeHighlight]}
                components={{
                  code(props) {
                    const { className, children, ...rest } = props;
                    const match = /language-(\w+)/.exec(className || "");
                    const code = String(children).replace(/\n$/, "");
                    if (match?.[1] === "mermaid") {
                      return (
                        <MermaidBlock
                          code={code}
                          isStreaming={isStreaming}
                        />
                      );
                    }
                    return (
                      <code className={className} {...rest}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          ) : isStreaming ? (
	            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border-light)] bg-[var(--color-panel)] px-3 py-2 shadow-[var(--shadow-panel)] backdrop-blur-[var(--glass-blur)]">
              <LoadingIndicator
                size="sm"
                variant="lissajous"
                label="等待模型响应"
                detail="正在建立输出流"
              />
            </div>
          ) : null}
          {isStreaming && content && <span className="typing-cursor" />}
        </div>

        {isAssistant && onSaveArtifact && id && !isStreaming && content && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowSave((current) => !current)}
	              className="flex items-center gap-1 rounded-[var(--radius-md)] border border-transparent px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] hover:border-[var(--color-border-light)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-accent)]"
              aria-expanded={showSave}
            >
              <Save size={12} />
              保存为成果
            </button>
            {showSave && (
	              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-xl)] border border-[var(--color-border-light)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-panel)] backdrop-blur-[var(--glass-blur)]">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
	                  className="h-8 min-w-40 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)] px-2 text-xs focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-muted)]"
                  maxLength={150}
                  aria-label="成果标题"
                />
	                <SelectMenu
	                  value={type}
	                  placeholder="成果类型"
	                  ariaLabel="成果类型"
	                  options={ARTIFACT_TYPES.map(([value, label]) => ({
	                    value,
	                    label,
	                  }))}
	                  onChange={setType}
	                  className="w-36"
	                />
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={saving || !title.trim()}
                  onClick={saveArtifact}
                  isLoading={saving}
                >
                  {saving ? "保存中" : "保存"}
                </Button>
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
