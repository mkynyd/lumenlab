"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ProjectSidebar } from "@/components/project/project-sidebar";
import { QuickTaskBar } from "@/components/chat/quick-task-bar";
import { ChatInput } from "@/components/chat/chat-input";
import { VirtualMessageList } from "@/components/chat/virtual-message-list";
import { ModelSelector } from "@/components/chat/model-selector";
import { ContextRing } from "@/components/chat/context-ring";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, Hash, Loader, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useChat } from "@/lib/hooks/use-chat";
import type { ProjectFile } from "@/components/project/file-list";
import type { ProjectType } from "@/components/chat/quick-task-bar";
import { FileContentDialog } from "@/components/project/file-content-dialog";
import { ArtifactLibrary } from "@/components/artifact/artifact-library";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/hooks/use-projects";
import {
  conversationQueryOptions,
} from "@/lib/hooks/use-conversations";
import { useSaveArtifact } from "@/lib/hooks/use-artifacts";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectDetail } from "@/lib/api/types";

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const queryClient = useQueryClient();
  const projectQuery = useProject(projectId);
  const saveArtifactMutation = useSaveArtifact(projectId);
  const project = projectQuery.data || null;
  const isLoading = projectQuery.isPending;
  const [desktopProjectSidebarOpen, setDesktopProjectSidebarOpen] =
    useState(true);
  const [mobileProjectSidebarOpen, setMobileProjectSidebarOpen] =
    useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<ProjectFile | null>(null);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0);
  const selectedFileIdList = useMemo(
    () => Array.from(selectedFileIds),
    [selectedFileIds]
  );

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
        await queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(projectId),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.projects.files(projectId),
        });
      }
    } catch {
      // 静默处理
    }
  }

  async function runFileAction(file: ProjectFile, action: "parse" | "enhance") {
    setFileMessage(action === "parse" ? "正在解析资料..." : "正在进行知识增强...");
    queryClient.setQueryData<ProjectDetail>(
      queryKeys.projects.detail(projectId),
      (current) =>
        current
          ? {
              ...current,
              files: current.files.map((item) =>
                item.id === file.id
                  ? action === "parse"
                    ? { ...item, status: "parsing" }
                    : { ...item, enhancementStatus: "enhancing" }
                  : item
              ),
            }
          : current
    );
    try {
      const res = await fetch(`/api/files/${file.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      setFileMessage(
        action === "parse"
          ? data.file?.truncated
            ? "解析完成，仅处理了首批页面，已可用于上下文"
            : "解析完成，已可用于上下文"
          : "知识增强完成"
      );
    } catch (err) {
      setFileMessage(err instanceof Error ? err.message : "操作失败");
    } finally {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.files(projectId),
      });
    }
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

  async function handleSend(content: string) {
    setChatInputValue("");
    await sendMessage(content);
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projects.detail(projectId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.conversations.all,
    });
  }

  function handleQuickTaskFill(prompt: string) {
    setChatInputValue(prompt);
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
        className={cn(
          "absolute inset-y-0 left-0 z-30 w-[280px] overflow-hidden",
          "border-r border-[var(--color-border)] bg-[var(--color-surface)]",
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
            onFileDelete={handleFileDelete}
            onFileUploaded={() => void projectQuery.refetch()}
            onFileParse={(file) => void runFileAction(file, "parse")}
            onFileEnhance={(file) => void runFileAction(file, "enhance")}
            onFileView={setActiveFile}
            onNewConversation={handleNewConversation}
            onConversationSelect={handleConversationSelect}
            activeConversationId={conversationId}
          />
        </div>
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
              onClick={toggleProjectSidebar}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)]",
                "border border-[var(--color-border)] bg-[var(--color-surface)]",
                "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
                "transition-colors duration-150"
              )}
              aria-label="切换项目侧边栏"
            >
              <span className="md:hidden">
                {mobileProjectSidebarOpen ? (
                  <PanelLeftClose size={16} strokeWidth={1.8} />
                ) : (
                  <PanelLeftOpen size={16} strokeWidth={1.8} />
                )}
              </span>
              <span className="hidden md:inline">
                {desktopProjectSidebarOpen ? (
                  <PanelLeftClose size={16} strokeWidth={1.8} />
                ) : (
                  <PanelLeftOpen size={16} strokeWidth={1.8} />
                )}
              </span>
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
            <Button variant="ghost" size="sm" onClick={() => setShowArtifacts(true)}>
              成果库
            </Button>
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
        {messages.length === 0 ? (
          <div className="flex-1 overflow-y-auto">
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
        {fileMessage && (
          <div className="mx-4 mb-2 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-xs">
            <span>{fileMessage}</span>
            <button onClick={() => setFileMessage(null)}>关闭</button>
          </div>
        )}

        {/* 输入框 */}
        <ChatInput
          onSend={handleSend}
          onStop={abort}
          isStreaming={isStreaming}
          value={chatInputValue}
          onValueChange={setChatInputValue}
        />
        {project.files.length > 0 && selectedFileIds.size === 0 && (
          <p className="px-4 pb-2 -mt-1 text-[11px] text-[var(--color-text-tertiary)] bg-[var(--color-surface)]">
            未选择文件时，系统会在当前项目中进行关键词检索。
          </p>
        )}
      </div>
      {activeFile && (
        <FileContentDialog
          file={activeFile}
          onClose={() => setActiveFile(null)}
          onUpdated={() => void projectQuery.refetch()}
        />
      )}
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
