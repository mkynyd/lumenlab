"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ProjectSidebar } from "@/components/project/project-sidebar";
import { QuickTaskBar } from "@/components/chat/quick-task-bar";
import { ChatInput } from "@/components/chat/chat-input";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ModelSelector } from "@/components/chat/model-selector";
import { ContextRing } from "@/components/chat/context-ring";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, Hash, Loader } from "lucide-react";
import { useChat, type ChatMessage } from "@/lib/hooks/use-chat";
import type { ProjectFile } from "@/components/project/file-list";
import type { ProjectType } from "@/components/chat/quick-task-bar";

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  type: string;
  files: ProjectFile[];
  conversations: { id: string; title: string; updatedAt: string }[];
}

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<ProjectData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const selectedFileIdList = useMemo(
    () => Array.from(selectedFileIds),
    [selectedFileIds]
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Chat state
  const [chatInputValue, setChatInputValue] = useState("");
  const {
    messages,
    isStreaming,
    error,
    usage,
    model,
    thinkingEnabled,
    setModel,
    setThinkingEnabled,
    sendMessage,
    abort,
    clearError,
    newConversation,
    loadConversation,
    conversationId,
  } = useChat({
    initialConversationId: undefined,
    initialMessages: [],
    projectId,
    selectedFileIds: selectedFileIdList,
    mode: (project?.type as ProjectType | undefined) ?? "general",
  });

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
      }
    } catch {
      // 静默处理
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchProject();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchProject]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleFileToggle(id: string) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFileDelete(id: string) {
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        fetchProject();
      }
    } catch {
      // 静默处理
    }
  }

  async function handleSend(content: string) {
    setChatInputValue("");
    await sendMessage(content);
    await fetchProject();
  }

  function handleQuickTaskFill(prompt: string) {
    setChatInputValue(prompt);
  }

  async function handleConversationSelect(nextConversationId: string) {
    if (isStreaming || nextConversationId === conversationId) return;

    try {
      const res = await fetch(`/api/conversations/${nextConversationId}`);
      if (!res.ok) {
        throw new Error("无法加载该项目对话");
      }

      const data = await res.json();
      if (data.conversation.projectId !== projectId) {
        throw new Error("该对话不属于当前项目");
      }

      loadConversation(
        data.conversation.id,
        data.conversation.messages.map((message: ChatMessage) => ({
          ...message,
          role: message.role as ChatMessage["role"],
        }))
      );
      setChatInputValue("");
    } catch (err) {
      console.error(
        "加载项目对话失败:",
        err instanceof Error ? err.message : "未知错误"
      );
    }
  }

  function handleNewConversation() {
    newConversation();
    setChatInputValue("");
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader size={20} strokeWidth={1.5} className="animate-spin text-[var(--color-text-tertiary)]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <h2 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
          项目不存在
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          该项目可能已被删除或无访问权限
        </p>
      </div>
    );
  }

  const projectType = project.type as ProjectType;

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧项目侧栏 */}
      <div
        className={cn(
          "w-[280px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)]",
          "transition-all duration-200 overflow-hidden",
          sidebarOpen ? "w-[280px]" : "w-0"
        )}
      >
        <ProjectSidebar
          project={project}
          selectedFileIds={selectedFileIds}
          onFileToggle={handleFileToggle}
          onFileDelete={handleFileDelete}
          onFileUploaded={fetchProject}
          onNewConversation={handleNewConversation}
          onConversationSelect={handleConversationSelect}
          activeConversationId={conversationId}
        />
      </div>

      {/* 右侧工作区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部信息栏 */}
        <div
          className={cn(
            "flex items-center justify-between px-4 py-2",
            "border-b border-[var(--color-border)]",
            "bg-[var(--color-surface)] shrink-0"
          )}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="切换侧边栏"
            >
              <Hash size={16} strokeWidth={2} />
            </button>
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
              {project.name}
            </span>
            <span className="hidden sm:inline text-[11px] font-mono text-[var(--color-text-tertiary)]">
              {projectType === "experiment"
                ? "实验工作台"
                : projectType === "review"
                  ? "资料复习"
                  : projectType === "coding"
                    ? "代码项目"
                    : "通用模式"}
            </span>
            <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">
              已选 {selectedFileIds.size} 个文件
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ModelSelector model={model} onChange={setModel} disabled={isStreaming} />
            <Switch
              checked={thinkingEnabled}
              onChange={setThinkingEnabled}
              label="思考模式"
            />
            {usage && (
              <ContextRing used={usage.totalTokens} />
            )}
          </div>
        </div>

        {/* 快捷任务按钮 */}
        <div className="px-4 py-2 border-b border-[var(--color-border-light)] shrink-0">
          <QuickTaskBar
            projectType={projectType}
            onFill={handleQuickTaskFill}
          />
        </div>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div
                className={cn(
                  "flex items-center justify-center w-12 h-12 mb-4 rounded-[var(--radius-md)]",
                  "border border-[var(--color-border)]",
                  "bg-[var(--color-surface)]"
                )}
              >
                <Hash size={24} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
              </div>
              <h2 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
                {project.name}
              </h2>
              {selectedFileIds.size > 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  已选择 {selectedFileIds.size} 个文件作为上下文，点击快捷任务或输入问题开始对话
                </p>
              ) : (
                <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
                  上传实验截图、代码、数据表、课件或试卷，开始构建项目上下文
                </p>
              )}
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                reasoningContent={msg.reasoningContent}
                tokenCount={msg.tokenCount ?? undefined}
                isStreaming={msg.isStreaming}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 错误提示 */}
        {error && (
          <div
            className={cn(
              "flex items-center gap-2 px-4 py-2 mx-4 mb-2 rounded-[var(--radius-md)]",
              "bg-[var(--color-error-muted)] border border-[var(--color-error)]/20",
              "text-sm text-[var(--color-error)]"
            )}
          >
            <AlertCircle size={14} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={clearError}
              className="text-xs underline hover:no-underline"
            >
              关闭
            </button>
          </div>
        )}

        {/* 输入框 */}
        <ChatInput
          onSend={handleSend}
          onStop={abort}
          isStreaming={isStreaming}
          value={chatInputValue}
          onValueChange={setChatInputValue}
          disabled={project.files.length > 0 && selectedFileIds.size === 0}
        />
        {project.files.length > 0 && selectedFileIds.size === 0 && (
          <p className="px-4 pb-2 -mt-1 text-[11px] text-[var(--color-text-tertiary)] bg-[var(--color-surface)]">
            请先在左侧选择至少一个文件，或新建普通聊天。
          </p>
        )}
      </div>
    </div>
  );
}
