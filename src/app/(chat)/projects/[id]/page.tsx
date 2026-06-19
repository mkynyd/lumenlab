"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ProjectSidebar } from "@/components/project/project-sidebar";
import { QuickTaskBar, type QuickTaskSendInput } from "@/components/chat/quick-task-bar";
import { ChatInput } from "@/components/chat/chat-input";
import { VirtualMessageList } from "@/components/chat/virtual-message-list";
import { ContextRing } from "@/components/chat/context-ring";
import {
  Hashtag,
  SidebarCollapse,
  SidebarExpand,
  WarningTriangle,
} from "iconoir-react";
import { AmbientField } from "@/components/workbench/ambient-field";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
import {
  useChat,
  type ChatMessage,
  type SendMessageInput,
} from "@/lib/hooks/use-chat";
import type { FileAttachment } from "@/lib/chat/router";
import type {
  FileSelectionIntent,
  ProjectFile,
} from "@/components/project/file-list";
import { FileContentDialog } from "@/components/project/file-content-dialog";
import type { ProjectType } from "@/components/chat/quick-task-bar";
import { ArtifactLibrary } from "@/components/artifact/artifact-library";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/hooks/use-projects";
import {
  conversationQueryOptions,
  useDeleteConversation,
} from "@/lib/hooks/use-conversations";
import { useSaveArtifact } from "@/lib/hooks/use-artifacts";
import { queryKeys } from "@/lib/query-keys";

type PersistedConversationMessage = {
  id: string;
  role: string;
  content: string;
  reasoningContent?: string | null;
  tokenCount?: number | null;
  cacheHitTokens?: number | null;
  cacheMissTokens?: number | null;
};

function isEmptyAssistantPlaceholder(message: PersistedConversationMessage) {
  return (
    message.role === "assistant" &&
    !message.content.trim() &&
    !message.reasoningContent?.trim() &&
    message.tokenCount == null
  );
}

function toChatMessages(messages: PersistedConversationMessage[]): ChatMessage[] {
  const pendingIndex = messages.reduce(
    (foundIndex, message, index) =>
      isEmptyAssistantPlaceholder(message) ? index : foundIndex,
    -1
  );

  return messages.map((message, index) => ({
    ...message,
    role: message.role as "user" | "assistant" | "system",
    isStreaming: index === pendingIndex || undefined,
    streamingSource: index === pendingIndex ? "background" : undefined,
  }));
}

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
  const [previewFile, setPreviewFile] = useState<ProjectFile | null>(null);
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
    reasoningEffort,
    setModel,
    setReasoningEffort,
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
  const hasBackgroundPendingMessage = messages.some(
    (message) =>
      message.role === "assistant" &&
      message.isStreaming &&
      message.streamingSource === "background"
  );
  const emptyForegroundPersistedMessageKey = messages
    .filter(
      (message) =>
        message.role === "assistant" &&
        message.isStreaming &&
        message.streamingSource === "foreground" &&
        !message.id.startsWith("assistant-") &&
        !message.content.trim() &&
        !message.reasoningContent?.trim()
    )
    .map((message) => message.id)
    .join("|");
  const [stalledForegroundMessageKey, setStalledForegroundMessageKey] =
    useState<string | null>(null);
  const shouldPollPendingConversation =
    hasBackgroundPendingMessage ||
    (Boolean(emptyForegroundPersistedMessageKey) &&
      stalledForegroundMessageKey === emptyForegroundPersistedMessageKey);

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

  useEffect(() => {
    if (!emptyForegroundPersistedMessageKey) return;

    const timer = window.setTimeout(() => {
      setStalledForegroundMessageKey(emptyForegroundPersistedMessageKey);
    }, 12000);

    return () => window.clearTimeout(timer);
  }, [emptyForegroundPersistedMessageKey]);

  useEffect(() => {
    if (!conversationId || !shouldPollPendingConversation) return;

    const activeConversationId = conversationId;
    let cancelled = false;
    async function refreshPendingConversation() {
      try {
        const conversation = await queryClient.fetchQuery(
          conversationQueryOptions(activeConversationId)
        );
        if (cancelled || conversation.projectId !== projectId) return;

        const nextMessages = toChatMessages(conversation.messages);
        loadConversation(conversation.id, nextMessages, {
          model: conversation.model,
          thinkingEnabled: conversation.thinkingEnabled ?? true,
        });

        if (!nextMessages.some((message) => message.isStreaming)) {
          await queryClient.invalidateQueries({
            queryKey: queryKeys.projects.detail(projectId),
          });
          await queryClient.invalidateQueries({
            queryKey: queryKeys.conversations.all,
          });
        }
      } catch {
        // Keep the background placeholder visible; the next tick can recover.
      }
    }

    void refreshPendingConversation();
    const timer = window.setInterval(() => {
      void refreshPendingConversation();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    conversationId,
    loadConversation,
    projectId,
    queryClient,
    shouldPollPendingConversation,
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

  async function runBatchAction(
    action: "delete" | "reparse" | "categorize" | "download",
    explicitFileIds?: string[]
  ) {
    const fileIds = explicitFileIds || Array.from(selectedFileIds);
    if (fileIds.length === 0) return;
    const res = await fetch(`/api/projects/${projectId}/files/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, fileIds }),
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
    await runBatchAction("reparse", fileIds);
  }

  async function handleBatchAutoCategorize() {
    const fileIds = (project?.files || [])
      .filter((file) => ["parsed", "partial"].includes(file.status))
      .map((file) => file.id);
    await runBatchAction("categorize", fileIds);
  }

  async function handleFileAction(
    action: "delete" | "reparse" | "download" | "preview",
    fileId: string
  ) {
    if (action === "preview") {
      const file = project?.files.find((item) => item.id === fileId) || null;
      if (file) setPreviewFile(file);
      return;
    }
    if (action === "download") {
      const res = await fetch(`/api/files/${fileId}/download`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setFileMessage(data?.error || "文件下载失败");
        return;
      }
      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.url) {
          window.open(data.url, "_blank", "noopener,noreferrer");
          return;
        }
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const file = project?.files.find((item) => item.id === fileId);
      link.href = url;
      link.download = file?.originalName || "download";
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    await runBatchAction(action, [fileId]);
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
    if (nextConversationId === conversationId) return;

    try {
      const conversation = await queryClient.fetchQuery(
        conversationQueryOptions(nextConversationId)
      );
      if (conversation.projectId !== projectId) {
        throw new Error("该对话不属于当前项目");
      }

      loadConversation(
        conversation.id,
        toChatMessages(conversation.messages),
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

  async function handleConversationDelete(id: string) {
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
          "bg-[var(--color-surface)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          mobileProjectSidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:z-auto md:translate-x-0 md:transition-[width] md:duration-300 md:ease-[cubic-bezier(0.16,1,0.3,1)]",
          desktopProjectSidebarOpen ? "md:w-[280px]" : "md:w-0"
        )}
      >
        <div
          className={cn(
            "h-full w-full transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
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
            onFileUploaded={() => void projectQuery.refetch()}
            onBatchDelete={() => void runBatchAction("delete")}
            onBatchReparse={() => void runBatchAction("reparse")}
            onBatchAutoCategorize={() => void handleBatchAutoCategorize()}
            onBatchReparseFailed={() => void handleBatchReparseFailed()}
            onBatchDownload={() => void runBatchAction("download")}
            onFileAction={(action, fileId) => void handleFileAction(action, fileId)}
            onNewConversation={handleNewConversation}
            onConversationSelect={handleConversationSelect}
            onConversationDelete={(id) => void handleConversationDelete(id)}
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
	                "bg-[var(--color-surface)]",
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
                <span className="hidden rounded-[var(--radius-md)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-tertiary)] sm:inline">
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
	                  "bg-[var(--color-panel)]"
	                )}
              >
	                <Hashtag width={24} height={24} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
              </div>
              <h2 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
                {project.name}
              </h2>
              {selectedFileIds.size > 0 && (
                <p className="max-w-md text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  已选择 {selectedFileIds.size} 个文件作为上下文，点击快捷任务或输入问题开始对话
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
              "bg-[var(--color-error-muted)]",
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
          <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <span>{fileMessage}</span>
            <button
              onClick={() => setFileMessage(null)}
              className="rounded-[var(--radius-sm)] px-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              关闭
            </button>
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
          model={model}
          onModelChange={setModel}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
        />
      </div>
      {showArtifacts && (
        <ArtifactLibrary
          projectId={projectId}
          refreshKey={artifactRefreshKey}
          onClose={() => setShowArtifacts(false)}
        />
      )}
      {previewFile && (
        <FileContentDialog
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onUpdated={() => void projectQuery.refetch()}
        />
      )}
    </div>
  );
}
