"use client";

import { memo, useState } from "react";
import { TaskList } from "iconoir-react";
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  GraduationCap,
  Lightbulb,
  Save,
} from "lucide-react";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
import type { OrbState } from "thinking-orbs";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  isArtifactContentSavable,
  suggestArtifactTitle,
} from "@/lib/artifacts/content";
import type { AgentSource } from "@/lib/agent/sources";
import type { AssistantProcessTrace } from "@/lib/agent/assistant-process";
import type { ApprovalScope } from "@/lib/agent/types";
import { AssistantProcess } from "@/components/chat/assistant-process";

interface MessageBubbleProps {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoningContent?: string | null;
  tokenCount?: number | null;
  sources?: AgentSource[] | null;
  isStreaming?: boolean;
  /** 流式期间正在执行的工具 ID（映射为「正在搜索」等状态行） */
  activeToolId?: string | null;
  /** 本轮已完成的工具调用数，用于输出末尾的摘要行 */
  toolsUsed?: number;
  process?: AssistantProcessTrace;
  onApproveTool?: (
    executionId: string,
    token: string,
    scope: ApprovalScope
  ) => Promise<void> | void;
  onDenyTool?: (executionId: string) => Promise<void> | void;
  onSaveArtifact?: (input: {
    messageId: string;
    title: string;
    type: string;
    content: string;
  }) => Promise<void>;
  onSkillFollowUp?: (skillId: string) => void;
}

/** 工具 ID → 流式状态行（标签 + thinking-orbs 动画）；未列出的工具保持静默 */
const TOOL_STATUS: Record<string, { label: string; orb: OrbState }> = {
  "web.search": { label: "正在搜索", orb: "searching" },
  "web.fetch": { label: "正在读取网页", orb: "connecting" },
  "project_rag.search": { label: "正在检索资料", orb: "weaving" },
  "project_files.list": { label: "正在检索资料", orb: "weaving" },
  "project_files.read": { label: "正在读取资料", orb: "weaving" },
  "arxiv.search": { label: "正在检索论文", orb: "searching" },
  "arxiv.read": { label: "正在读取论文", orb: "connecting" },
  "arxiv.fetch": { label: "正在读取论文", orb: "connecting" },
};

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

function sourceIcon(type: AgentSource["type"]) {
  if (type === "web") return <ExternalLink size={12} />;
  if (type === "project_file") return <FileText size={12} />;
  if (type === "arxiv") return <BookOpen size={12} />;
  return <Archive size={12} />;
}

function MessageSources({ sources }: { sources?: AgentSource[] | null }) {
  const visible = (sources ?? []).slice(0, 5);
  if (visible.length === 0) return null;

  return (
    <div className="message-source-tray">
      <div className="message-source-title">来源 · {sources?.length ?? 0}</div>
      <div className="message-source-list">
        {visible.map((source, index) => {
          const label = source.title || source.url || source.fileId || `来源 ${index + 1}`;
          const content = (
            <>
              {sourceIcon(source.type)}
              <span className="max-w-[18rem] truncate">{label}</span>
            </>
          );
          const className = "message-source-item";

          return source.url ? (
            <a
              key={`${source.type}-${source.url}-${index}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className={className}
            >
              {content}
            </a>
          ) : (
            <span key={`${source.type}-${source.fileId ?? source.artifactId ?? index}`} className={className}>
              {content}
            </span>
          );
        })}
        {(sources?.length ?? 0) > visible.length && (
          <span className="message-source-more">
            +{(sources?.length ?? 0) - visible.length}
          </span>
        )}
      </div>
    </div>
  );
}

const FOLLOW_UP_ACTIONS = [
  { skillId: "socratic-tutor", label: "引导我深入理解", icon: Lightbulb },
  { skillId: "exam-extract", label: "考点分析", icon: TaskList },
  { skillId: "exam-coach", label: "生成速记卡", icon: GraduationCap },
] as const;

function SkillFollowUpButtons({
  onSkillFollowUp,
}: {
  onSkillFollowUp?: (skillId: string) => void;
}) {
  if (!onSkillFollowUp) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {FOLLOW_UP_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.skillId}
            type="button"
            onClick={() => onSkillFollowUp(action.skillId)}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
          >
            <Icon size={12} />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

function MessageBubbleComponent({
  id,
  role,
  content,
  reasoningContent,
  tokenCount,
  sources,
  isStreaming = false,
  activeToolId,
  toolsUsed,
  process,
  onApproveTool,
  onDenyTool,
  onSaveArtifact,
  onSkillFollowUp,
}: MessageBubbleProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [title, setTitle] = useState(() => suggestArtifactTitle(content));
  const [type, setType] = useState("general");
  const [saving, setSaving] = useState(false);
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const hasReasoning = Boolean(reasoningContent?.trim());
  const shouldShowReasoning = isAssistant && (hasReasoning || isStreaming);
  const canSaveArtifact =
    isAssistant && !isStreaming && isArtifactContentSavable(content);
  const toolStatus =
    isStreaming && activeToolId && !process ? (TOOL_STATUS[activeToolId] ?? null) : null;
  const summaryParts: string[] = [];
  if (!isStreaming) {
    if (toolsUsed) summaryParts.push(`使用 ${toolsUsed} 个工具`);
    if (sources?.length) summaryParts.push(`${sources.length} 个来源`);
  }

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
    <div className="w-full px-4 py-3 md:px-6 md:py-4">
      <div
        className={cn(
          "mx-auto flex w-full max-w-[48rem]",
          isUser && "justify-end"
        )}
      >
        <div className={cn("min-w-0", isUser ? "flex w-full flex-col items-end" : "w-full")}>
        {isAssistant && (process || shouldShowReasoning) && (
          <AssistantProcess
            trace={process}
            reasoningContent={reasoningContent}
            isStreaming={isStreaming}
            hasResponse={Boolean(content)}
            onApprove={onApproveTool}
            onDeny={onDenyTool}
          />
        )}

        {shouldShowReasoning && !process && (
          <Collapsible
            open={showReasoning}
            onOpenChange={setShowReasoning}
            className="mb-2 w-full"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 py-1 text-xs text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
                aria-expanded={showReasoning}
              >
                {isStreaming && !hasReasoning ? (
                  <Spinner className="size-3" />
                ) : showReasoning ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                {hasReasoning ? "思考过程" : "正在思考"}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1.5 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {hasReasoning ? (
                  <div className="whitespace-pre-wrap">{reasoningContent}</div>
                ) : (
                  <LoadingIndicator
                    size="sm"
                    orb="solving"
                    label="正在推理"
                    detail="思考过程会在返回后同步显示"
                  />
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div
          className={cn(
            "chat-message-text",
            isUser
              ? "w-fit max-w-[85%] rounded-[22px] bg-[var(--color-interaction-active)] px-4 py-2.5 sm:max-w-[70%]"
              : "w-full"
          )}
        >
          {content ? (
            <MarkdownContent content={content} isStreaming={isStreaming} />
          ) : isStreaming && !process ? (
            <div className="py-1">
              {toolStatus ? (
                <LoadingIndicator size="sm" orb={toolStatus.orb} label={toolStatus.label} />
              ) : (
                <LoadingIndicator
                  size="sm"
                  orb="working"
                  label="等待模型响应"
                  detail="正在建立输出流"
                />
              )}
            </div>
          ) : null}
          {isStreaming && content && toolStatus && (
            <div className="py-1">
              <LoadingIndicator size="sm" orb={toolStatus.orb} label={toolStatus.label} />
            </div>
          )}
          {isStreaming && content && !toolStatus && <span className="typing-cursor" />}
        </div>

        {isAssistant && !isStreaming && <MessageSources sources={sources} />}

        {isAssistant && !isStreaming && content && sources && sources.length > 0 && (
          <SkillFollowUpButtons onSkillFollowUp={onSkillFollowUp} />
        )}

        {canSaveArtifact && onSaveArtifact && id && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowSave((current) => !current)}
              className="flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
              aria-expanded={showSave}
            >
              <Save size={12} />
              保存为成果
            </button>
            {showSave && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-light)] pt-3">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="min-w-40 text-xs"
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
                >
                  {saving && <Spinner data-icon="inline-start" />}
                  {saving ? "保存中" : "保存"}
                </Button>
              </div>
            )}
          </div>
        )}

        {(summaryParts.length > 0 || tokenCount != null) && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
            {summaryParts.length > 0 && <span>{summaryParts.join(" · ")}</span>}
            {summaryParts.length > 0 && tokenCount != null && (
              <span aria-hidden>·</span>
            )}
            {tokenCount != null && (
              <span className="font-mono">
                {tokenCount.toLocaleString()} tokens
              </span>
            )}
          </div>
        )}
      </div>
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
        previous.reasoningContent === next.reasoningContent &&
        previous.activeToolId === next.activeToolId &&
        previous.process === next.process
      );
    }
    return (
      previous.content === next.content &&
      previous.reasoningContent === next.reasoningContent &&
      previous.tokenCount === next.tokenCount &&
      previous.sources === next.sources &&
      previous.toolsUsed === next.toolsUsed &&
      previous.process === next.process &&
      previous.onSaveArtifact === next.onSaveArtifact &&
      previous.onApproveTool === next.onApproveTool &&
      previous.onDenyTool === next.onDenyTool
    );
  }
);
