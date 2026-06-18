"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ProjectSidebar } from "@/components/project/project-sidebar";
import { QuickTaskBar, type QuickTaskSendInput } from "@/components/chat/quick-task-bar";
import { ChatInput } from "@/components/chat/chat-input";
import { VirtualMessageList } from "@/components/chat/virtual-message-list";
import { ModelSelector } from "@/components/chat/model-selector";
import { ContextRing } from "@/components/chat/context-ring";
import { Switch } from "@/components/ui/switch";
import {
  Hashtag,
  SidebarCollapse,
  SidebarExpand,
  WarningTriangle,
} from "iconoir-react";
import { AmbientField } from "@/components/workbench/ambient-field";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
import { useChat, type SendMessageInput } from "@/lib/hooks/use-chat";
import type { FileAttachment } from "@/lib/chat/router";
import type {
  FileSelectionIntent,
} from "@/components/project/file-list";
import type { ProjectType } from "@/components/chat/quick-task-bar";
import type { FileCategory } from "@/lib/file-categories";
import { ArtifactLibrary } from "@/components/artifact/artifact-library";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/hooks/use-projects";
import {
  conversationQueryOptions,
  useDeleteConversation,
} from "@/lib/hooks/use-conversations";
import { useSaveArtifact } from "@/lib/hooks/use-artifacts";
import { queryKeys } from "@/lib/query-keys";

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const queryClient = useQueryClient();
  const projectQuery = useProject(projectId);
  const saveArtifactMutation = useSaveArtifact(projectId);
  const deleteConversationMutation = useDeleteConversation();
  const project = projectQuery.data || null;
  const refetchProject = projectQuery.refetch;
  const isLoading = projectQuery.isPending;
  const [desktopProjectSidebarOpen, setDesktopProjectSidebarOpen] =
    useState(true);
  const [mobileProjectSidebarOpen, setMobileProjectSidebarOpen] =
    useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0);
  const selectedFileIdList = useMemo(
    () => Array.from(selectedFileIds),
    [selectedFileIds]
  );

  // Chat state
  const [chatInputValue, setChatInputValue] = useState("");
  const [chatAttachments, setChatAttachments] = useState<FileAttachment[]>([]);
  const [pendingMessageQueue, setPendingMessageQueue] = useState<SendMessageInput[]>([]);
  const drainingQueueRef = useRef(false);
  const lastSelectedFileIndexRef = useRef<number | null>(null);
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
    model: project?.defaultModel || "deepseek-v4-pro",
    thinkingEnabled: project?.thinkingEnabled ?? true,
    projectId,
    selectedFileIds: selectedFileIdList,
    mode: (project?.type as ProjectType | undefined) ?? "general",
  });
  const hasParsingFiles = Boolean(
    project?.files.some((file) => file.status === "parsing")
  );

  useEffect(() => {
    fetch("/api/files/cleanup-stale", { method: "POST" })
      .then(() => refetchProject())
      .catch(() => {});
  }, [projectId, refetchProject]);

  useEffect(() => {
    if (!hasParsingFiles) return;
    const timer = window.setInterval(() => {
      void refetchProject();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasParsingFiles, refetchProject]);

  useEffect(() => {
    if (
      hasParsingFiles ||
      isStreaming ||
      pendingMessageQueue.length === 0 ||
      drainingQueueRef.current
    ) {
      return;
    }

    drainingQueueRef.current = true;
    const queue = [...pendingMessageQueue];
    setPendingMessageQueue([]);
    void (async () => {
      for (const item of queue) {
        await sendMessage(item);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(projectId),
      });
      drainingQueueRef.current = false;
    })().catch((err) => {
      setFileMessage(err instanceof Error ? err.message : "队列消息发送失败");
      drainingQueueRef.current = false;
    });
  }, [
    hasParsingFiles,
    isStreaming,
    pendingMessageQueue,
    projectId,
    queryClient,
    sendMessage,
  ]);

  function handleFileToggle(id: string, intent: FileSelectionIntent) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      const orderedFiles = project?.files || [];
      if (intent.range && lastSelectedFileIndexRef.current !== null) {
        const start = Math.min(lastSelectedFileIndexRef.current, intent.index);
        const end = Math.max(lastSelectedFileIndexRef.current, intent.index);
        for (const file of orderedFiles.slice(start, end + 1)) {
          next.add(file.id);
        }
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      lastSelectedFileIndexRef.current = intent.index;
      return next;
    });
  }

  function handleSelectAllFiles() {
    setSelectedFileIds(new Set((project?.files || []).map((file) => file.id)));
  }

  function handleClearFileSelection() {
    setSelectedFileIds(new Set());
    lastSelectedFileIndexRef.current = null;
  }

  function handleSelectFilesByCategory(category: FileCategory) {
    setSelectedFileIds(new Set(
      (project?.files || [])
        .filter((file) => file.category === category && (file.categoryConfidence ?? 1) >= 0.7)
        .map((file) => file.id)
    ));
  }

  async function runBatchAction(
    action: "delete" | "reparse" | "categorize" | "download",
    category?: FileCategory,
    explicitFileIds?: string[]
  ) {
    const fileIds = explicitFileIds || Array.from(selectedFileIds);
    if (fileIds.length === 0) return;
    const res = await fetch(`/api/projects/${projectId}/files/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, fileIds, category }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFileMessage(data.error || "批量操作失败");
      return;
    }
    if (action === "download") {
      const blob = new Blob([data.content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.click();
      URL.revokeObjectURL(url);
    } else if (action === "delete") {
      setSelectedFileIds(new Set());
    }
    await projectQuery.refetch();
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projects.files(projectId),
    });
  }

  async function handleBatchReparseFailed() {
    const fileIds = (project?.files || [])
      .filter((file) => file.status === "failed")
      .map((file) => file.id);
    await runBatchAction("reparse", undefined, fileIds);
  }

  async function handleBatchAutoCategorize() {
    const fileIds = (project?.files || [])
      .filter((file) => ["parsed", "partial"].includes(file.status))
      .map((file) => file.id);
    await runBatchAction("categorize", undefined, fileIds);
  }

  async function saveArtifact(input: {
    messageId: string;
    title: string;
    type: string;
    content: string;
  }) {
    await saveArtifactMutation.mutateAsync({
      ...input,
      conversationId,
    });
    setArtifactRefreshKey((value) => value + 1);
    setFileMessage("已保存到成果库");
  }

  async function sendOrQueue(input: SendMessageInput) {
    if (hasParsingFiles) {
      setPendingMessageQueue((current) => [...current, input]);
      setFileMessage("文件解析中，请稍候...");
      return;
    }
    await sendMessage(input);
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projects.detail(projectId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.conversations.all,
    });
  }

  async function handleSend(content: string, attachments: FileAttachment[]) {
    setChatInputValue("");
    await sendOrQueue({ content, attachments });
  }

  async function handleQuickTaskSend(input: QuickTaskSendInput) {
    setChatInputValue("");
    await sendOrQueue({
      content: input.label,
      hiddenPrompt: input.prompt,
    });
  }

  async function handleConversationSelect(nextConversationId: string) {
    if (isStreaming || nextConversationId === conversationId) return;

    try {
      const conversation = await queryClient.fetchQuery(
        conversationQueryOptions(nextConversationId)
      );
      if (conversation.projectId !== projectId) {
        throw new Error("该对话不属于当前项目");
      }

      loadConversation(
        conversation.id,
        conversation.messages.map((message) => ({
          ...message,
          role: message.role as "user" | "assistant" | "system",
        })),
        {
          model: conversation.model,
          thinkingEnabled: conversation.thinkingEnabled ?? true,
        }
      );
      setChatInputValue("");
      setChatAttachments([]);
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
    setChatAttachments([]);
  }

  async function handleConversationDelete(id: string, title: string) {
    if (!confirm(`确定要删除项目对话「${title}」吗？`)) return;
    await deleteConversationMutation.mutateAsync(id);
    if (conversationId === id) {
      handleNewConversation();
    }
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projects.detail(projectId),
    });
  }

  function toggleProjectSidebar() {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setDesktopProjectSidebarOpen((current) => !current);
      return;
    }

    setMobileProjectSidebarOpen((current) => !current);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingIndicator
          size="md"
          variant="lissajous"
          label="加载项目工作台"
          detail="正在读取资料索引"
        />
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
  const projectModeLabel =
    projectType === "experiment"
      ? "实验工作台"
      : projectType === "review"
        ? "资料复习"
        : projectType === "coding"
          ? "代码项目"
          : "通用模式";
  const contextHint =
    selectedFileIds.size > 0
      ? `当前上下文：${selectedFileIds.size} 个已选文件`
      : project.files.length > 0
        ? "项目资料按问题自动匹配"
        : "等待上传资料后构建项目上下文";
  const blockedReason = hasParsingFiles
    ? "文件解析中，消息会等待资料就绪后发送"
    : undefined;

  return (
    <div className="relative flex h-full overflow-hidden">
      <button
        type="button"
        className={cn(
          "absolute inset-0 z-20 bg-slate-950/20 transition-opacity duration-300 ease-out md:hidden motion-reduce:transition-none",
          mobileProjectSidebarOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileProjectSidebarOpen(false)}
        aria-label="关闭项目侧边栏遮罩"
        aria-hidden={!mobileProjectSidebarOpen}
        tabIndex={mobileProjectSidebarOpen ? 0 : -1}
      />

      {/* 左侧项目侧栏 */}
      <div
        aria-label="项目资料侧边栏"
        className={cn(
          "absolute inset-y-0 left-0 z-30 w-[280px] overflow-hidden",
          "border-r border-[var(--color-border-light)] bg-[var(--color-surface)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          mobileProjectSidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:z-auto md:translate-x-0 md:transition-[width] md:duration-300 md:ease-[cubic-bezier(0.16,1,0.3,1)]",
          desktopProjectSidebarOpen ? "md:w-[280px]" : "md:w-0"
        )}
      >
        <div
          className={cn(
            "h-full w-[280px] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            desktopProjectSidebarOpen
              ? "md:translate-x-0"
              : "md:-translate-x-full"
          )}
        >
          <ProjectSidebar
            project={project}
            selectedFileIds={selectedFileIds}
            onFileToggle={handleFileToggle}
            onSelectAllFiles={handleSelectAllFiles}
            onClearFileSelection={handleClearFileSelection}
            onSelectFilesByCategory={handleSelectFilesByCategory}
            onFileUploaded={() => void projectQuery.refetch()}
            onBatchDelete={() => void runBatchAction("delete")}
            onBatchReparse={() => void runBatchAction("reparse")}
            onBatchAutoCategorize={() => void handleBatchAutoCategorize()}
            onBatchReparseFailed={() => void handleBatchReparseFailed()}
            onBatchDownload={() => void runBatchAction("download")}
            onNewConversation={handleNewConversation}
            onConversationSelect={handleConversationSelect}
            onConversationDelete={(id, title) =>
              void handleConversationDelete(id, title)
            }
            activeConversationId={conversationId}
          />
        </div>
      </div>

      {/* 右侧工作区 */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-bg)]">
        {/* 顶部信息栏 */}
        <div
          className={cn(
            "flex min-h-14 items-center justify-between gap-3 px-4 py-2",
            "border-b border-[var(--color-border-light)]",
            "bg-[var(--color-panel)] shrink-0 backdrop-blur-[var(--glass-blur)]"
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={toggleProjectSidebar}
              className={cn(
	                "inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]",
	                "border border-[var(--color-border-light)] bg-[var(--color-surface)] shadow-sm",
                "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
                "transition-colors duration-150"
              )}
              aria-label="切换项目侧边栏"
            >
              <span className="md:hidden">
	                {mobileProjectSidebarOpen ? (
	                  <SidebarCollapse width={16} height={16} strokeWidth={1.8} />
	                ) : (
	                  <SidebarExpand width={16} height={16} strokeWidth={1.8} />
	                )}
              </span>
              <span className="hidden md:inline">
	                {desktopProjectSidebarOpen ? (
	                  <SidebarCollapse width={16} height={16} strokeWidth={1.8} />
	                ) : (
	                  <SidebarExpand width={16} height={16} strokeWidth={1.8} />
	                )}
              </span>
            </button>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {project.name}
                </span>
                <span className="hidden rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-tertiary)] sm:inline">
                  {projectModeLabel}
                </span>
              </div>
              <p className="hidden truncate text-[11px] text-[var(--color-text-tertiary)] sm:block">
                {contextHint}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowArtifacts(true)}
              className="shrink-0"
            >
              成果库
            </Button>
            <ModelSelector model={model} onChange={setModel} disabled={isStreaming} />
            <Switch
              checked={thinkingEnabled}
              onChange={setThinkingEnabled}
              label="思考模式"
              className="[&>span]:hidden sm:[&>span]:inline"
            />
            {usage && (
              <ContextRing used={usage.totalTokens} />
            )}
          </div>
        </div>

        {/* 快捷任务按钮 */}
	        <div className="border-b border-[var(--color-border-light)] bg-[var(--color-panel)] px-4 py-2 shrink-0 backdrop-blur-[var(--glass-blur)]">
          <QuickTaskBar
            projectType={projectType}
            actions={project.quickActions}
            onSend={(input) => void handleQuickTaskSend(input)}
            disabled={isStreaming}
          />
        </div>

        {/* 消息区域 */}
        {messages.length === 0 ? (
          <div className="relative flex-1 overflow-y-auto">
	            <AmbientField density="wide" className="opacity-80" />
            <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
              <div
                className={cn(
                  "mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)]",
                  "border border-[var(--color-border)]",
                  "bg-[var(--color-panel)] shadow-[var(--shadow-panel)]"
                )}
              >
	                <Hashtag width={24} height={24} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
              </div>
              <h2 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
                {project.name}
              </h2>
              {selectedFileIds.size > 0 ? (
                <p className="max-w-md text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  已选择 {selectedFileIds.size} 个文件作为上下文，点击快捷任务或输入问题开始对话
                </p>
              ) : (
                <p className="max-w-sm text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  上传实验截图、代码、数据表、课件或试卷，开始构建项目上下文
                </p>
              )}
            </div>
          </div>
        ) : (
          <VirtualMessageList
            messages={messages}
            onSaveArtifact={saveArtifact}
          />
        )}

        {/* 错误提示 */}
        {error && (
          <div
            className={cn(
              "flex items-center gap-2 px-4 py-2 mx-4 mb-2 rounded-[var(--radius-md)]",
              "bg-[var(--color-error-muted)] border border-[var(--color-error)]/20",
              "text-sm text-[var(--color-error)]"
            )}
          >
	            <WarningTriangle width={14} height={14} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={clearError}
              className="text-xs underline hover:no-underline"
            >
              关闭
            </button>
          </div>
        )}
        {fileMessage && (
          <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <span>{fileMessage}</span>
            <button
              onClick={() => setFileMessage(null)}
              className="rounded-[var(--radius-sm)] px-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              关闭
            </button>
          </div>
        )}

        {/* 输入框 */}
        {hasParsingFiles && (
          <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-info-muted)] bg-[var(--color-info-muted)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <LoadingIndicator
              size="sm"
              variant="rose"
              label="文件解析中"
              detail="消息会等待资料完成后发送"
            />
            {pendingMessageQueue.length > 0 && (
              <span className="font-mono">已排队 {pendingMessageQueue.length} 条</span>
            )}
          </div>
        )}
        <ChatInput
          onSend={handleSend}
          onStop={abort}
          isStreaming={isStreaming}
          disabled={hasParsingFiles}
          value={chatInputValue}
          onValueChange={setChatInputValue}
          attachments={chatAttachments}
          onAttachmentsChange={setChatAttachments}
          contextHint={selectedFileIds.size > 0 ? contextHint : undefined}
          blockedReason={blockedReason}
        />
      </div>
      {showArtifacts && (
        <ArtifactLibrary
          projectId={projectId}
          refreshKey={artifactRefreshKey}
          onClose={() => setShowArtifacts(false)}
        />
      )}
    </div>
  );
}
