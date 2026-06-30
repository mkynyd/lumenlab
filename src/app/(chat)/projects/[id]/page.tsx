"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { ProjectSidebar } from "@/components/project/project-sidebar";
import { QuickTaskBar, type QuickTaskSendInput } from "@/components/chat/quick-task-bar";
import { ChatInput } from "@/components/chat/chat-input";
import {
  BUILTIN_SKILL_OPTIONS,
  type SkillSelectorValue,
} from "@/components/chat/skill-selector";
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
import { VectorLibraryView } from "@/components/vector-library/vector-library-view";
import { useProject } from "@/lib/hooks/use-projects";
import {
  conversationQueryOptions,
  useDeleteConversation,
} from "@/lib/hooks/use-conversations";
import { useSaveArtifact } from "@/lib/hooks/use-artifacts";
import { queryKeys } from "@/lib/query-keys";
import { toChatMessages } from "@/lib/chat/project-conversation-state";

// Empty-state quick prompts: tailored to project type. Project page is where
// context is loaded (files already uploaded), so these prompts are framed as
// "do this with my material" — they don't fit the chat route, which is generic
// (no project context, no uploaded files).
const SUGGESTED_PROMPTS: Record<ProjectType, string[]> = {
  review: [
    "梳理这份资料的章节结构与核心论点",
    "用通俗的话解释最关键的 3 个概念",
    "出 5 道判断题检验我的理解",
    "总结高频考点并按优先级排序",
  ],
  experiment: [
    "总结这份实验报告的研究目的和方法",
    "列出数据中的关键变量和异常点",
    "解释实验结论并指出可能的局限",
    "基于结果生成实验报告大纲",
  ],
  coding: [
    "解释这段代码的整体结构和依赖",
    "找出可能存在的 bug 和边界问题",
    "为这个模块生成文档与使用示例",
    "把这段代码改写成可读的函数注释",
  ],
  general: [
    "梳理这份资料的核心结构",
    "用通俗的话解释最关键的 3 个概念",
    "出 5 道题检验我的理解",
    "总结重点并标注优先级",
  ],
};

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
  const [showVectorLibrary, setShowVectorLibrary] = useState(false);
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0);
  const selectedFileIdList = useMemo(
    () => Array.from(selectedFileIds),
    [selectedFileIds]
  );

  // Chat state
  const [chatInputValue, setChatInputValue] = useState("");
  const [chatAttachments, setChatAttachments] = useState<FileAttachment[]>([]);
  const [userSkillValue, setUserSkillValue] =
    useState<SkillSelectorValue>("auto");
  const [pendingMessageQueue, setPendingMessageQueue] = useState<
    SendMessageInput[]
  >([]);
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
    agentSession,
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
  const skillValue: SkillSelectorValue = useMemo(() => {
    if (userSkillValue !== "auto") return userSkillValue;
    if (agentSession.activeSkill) {
      return agentSession.activeSkill.skillId as SkillSelectorValue;
    }
    return "auto";
  }, [userSkillValue, agentSession.activeSkill]);
  const activeSkillLabel = useMemo(() => {
    const activeSkillId = agentSession.activeSkill?.skillId;
    if (!activeSkillId) return null;
    return (
      BUILTIN_SKILL_OPTIONS.find((option) => option.value === activeSkillId)
        ?.label ?? activeSkillId
    );
  }, [agentSession.activeSkill?.skillId]);

  function withSkillSelection(input: SendMessageInput): SendMessageInput {
    if (skillValue === "off") {
      return { ...input, skillOff: true };
    }
    if (skillValue !== "auto") {
      return { ...input, manualSkillId: skillValue };
    }
    return input;
  }

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
    action: "delete" | "reparse" | "download",
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
    await sendOrQueue(withSkillSelection({ content, attachments }));
  }

  async function handleQuickTaskSend(input: QuickTaskSendInput) {
    setChatInputValue("");
    await sendOrQueue(
      withSkillSelection({
        content: input.label,
        hiddenPrompt: input.prompt,
      })
    );
  }

  async function handleSuggestedPromptSend(content: string) {
    await sendOrQueue(
      withSkillSelection({ content, attachments: chatAttachments })
    );
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
      logger.error("加载项目对话失败", {
        error: err instanceof Error ? err.message : "未知错误",
      });
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
    <div className="project-workbench relative flex h-full overflow-hidden">
      <button
        type="button"
        className={cn(
          "absolute inset-0 z-20 bg-[var(--color-overlay)] transition-opacity duration-300 ease-out md:hidden motion-reduce:transition-none",
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
            onBatchReparseFailed={() => void handleBatchReparseFailed()}
            onBatchDownload={() => void runBatchAction("download")}
            onFileAction={(action, fileId) => void handleFileAction(action, fileId)}
            onNewConversation={handleNewConversation}
            onConversationSelect={handleConversationSelect}
            onConversationDelete={(id) => void handleConversationDelete(id)}
            activeConversationId={conversationId}
            onShowArtifacts={() => setShowArtifacts(true)}
            onShowVectorLibrary={() => setShowVectorLibrary(true)}
          />
        </div>
      </div>

      {/* 右侧工作区 */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-bg)]">
        {/* 顶部信息栏 */}
        <div
          className={cn(
            "flex min-h-14 items-center justify-between gap-3 px-5 py-2.5",
            "bg-[var(--color-panel)] shrink-0 backdrop-blur-[var(--glass-blur)]"
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <button
              onClick={toggleProjectSidebar}
              className={cn(
	                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
	                "bg-[var(--color-project-control)]",
	                "text-[var(--color-text-tertiary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]",
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
            <div className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 sm:basis-auto">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {project.name}
                </span>
                <span className="rounded-xl bg-[var(--color-project-control)] px-2 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                  {projectModeLabel}
                </span>
                {activeSkillLabel && (
                  <span
                    className={cn(
                      "rounded-xl bg-[var(--color-accent)]/12 px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)]",
                      agentSession.activeSkill?.status === "awaiting_context" &&
                        "bg-[var(--color-warning-muted)] text-[var(--color-warning)]"
                    )}
                  >
                    {activeSkillLabel}
                  </span>
                )}
              </div>
              <p className="hidden truncate text-[11px] text-[var(--color-text-tertiary)] md:block">
                {contextHint}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto">
            {usage && (
              <ContextRing used={usage.totalTokens} />
            )}
          </div>
        </div>

        {/* 快捷任务按钮 */}
	        <div className="bg-[var(--color-panel)] px-5 py-2.5 shrink-0 backdrop-blur-[var(--glass-blur)]">
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
                data-dot-avoid
                className={cn(
	                  "mb-4 flex h-14 w-14 items-center justify-center rounded-2xl",
	                  "bg-[var(--color-panel)]"
	                )}
              >
	                <Hashtag width={26} height={26} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
              </div>
              <h2 data-dot-avoid className="text-base font-medium text-[var(--color-text-primary)] mb-1">
                {project.name}
              </h2>
              {selectedFileIds.size > 0 && (
                <p data-dot-avoid className="max-w-md text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  已选择 {selectedFileIds.size} 个文件作为上下文，点击快捷任务或输入问题开始对话
                </p>
              )}
              {project.files.length === 0 ? (
                <p data-dot-avoid className="mt-2 max-w-md text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  从左侧项目资料上传 PDF / Markdown，上传后 AI 会自动按问题匹配相关片段。
                </p>
              ) : (
                <div data-dot-avoid className="mt-5 flex w-full max-w-xl flex-wrap items-center justify-center gap-2">
                  {SUGGESTED_PROMPTS[projectType].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleSuggestedPromptSend(prompt)}
                      className={cn(
                        "rounded-[var(--radius-md)] px-3 py-1.5 text-xs",
                        "bg-[var(--color-surface)] text-[var(--color-text-secondary)]",
                        "hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
                        "focus-visible:bg-[var(--color-accent-soft)] focus-visible:text-[var(--color-text-primary)]",
                        "transition-colors duration-150"
                      )}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
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
              "flex items-center gap-2 px-4 py-2.5 mx-4 mb-2 rounded-2xl",
              "bg-[var(--color-error-muted)]",
              "text-sm text-[var(--color-error)]"
            )}
          >
	            <WarningTriangle width={14} height={14} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={clearError}
              className="rounded-md px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-error-muted)] focus-visible:text-[var(--color-error)]"
            >
              关闭
            </button>
          </div>
        )}
        {fileMessage && (
          <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-2xl bg-[var(--color-panel)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)]">
            <span>{fileMessage}</span>
            <button
              onClick={() => setFileMessage(null)}
              className="rounded-md px-1.5 py-0.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]"
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
          skillValue={skillValue}
          onSkillChange={setUserSkillValue}
        />
      </div>
      {showArtifacts && (
        <ArtifactLibrary
          projectId={projectId}
          refreshKey={artifactRefreshKey}
          onClose={() => setShowArtifacts(false)}
        />
      )}
      {showVectorLibrary && (
        <VectorLibraryView
          projectId={projectId}
          projectName={project?.name ?? ""}
          onClose={() => setShowVectorLibrary(false)}
          onReparseFile={(fileId) => void handleFileAction("reparse", fileId)}
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
