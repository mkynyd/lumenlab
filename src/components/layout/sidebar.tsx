"use client";

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  FolderOpen,
  MessageSquare,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  useConversations,
  useDeleteConversation,
} from "@/lib/hooks/use-conversations";
import { useProjects } from "@/lib/hooks/use-projects";

interface SidebarProps {
  mobileOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onExpand: () => void;
}

export function Sidebar({
  mobileOpen,
  collapsed,
  onClose,
  onExpand,
}: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeSection = pathname.startsWith("/projects") ? "projects" : "chat";
  const conversationsQuery = useConversations();
  const projectsQuery = useProjects();
  const deleteConversationMutation = useDeleteConversation();
  const conversations = conversationsQuery.data || [];
  const projects = projectsQuery.data || [];
  const isLoading =
    conversationsQuery.isPending || projectsQuery.isPending;

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    await deleteConversationMutation.mutateAsync(id);
    if (pathname === `/chat/${id}`) router.push("/chat");
  }

  function openSection(section: "chat" | "projects") {
    onExpand();
    onClose();
    router.push(section === "chat" ? "/chat" : "/projects");
  }

  function createItem() {
    onClose();
    router.push(activeSection === "chat" ? "/chat" : "/projects/new");
  }

  const activeConversationId = pathname.startsWith("/chat/")
    ? pathname.split("/").pop()
    : null;
  const activeProjectId = pathname.startsWith("/projects/")
    ? pathname.split("/")[2]
    : null;

  return (
    <>
      <button
        type="button"
        className={cn(
          "fixed inset-0 z-40 bg-slate-950/20 transition-opacity duration-300 ease-out lg:hidden motion-reduce:transition-none",
          mobileOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-label="关闭侧边栏遮罩"
        aria-hidden={!mobileOpen}
        tabIndex={mobileOpen ? 0 : -1}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-hidden",
          "border-r border-[var(--color-border-light)] bg-[var(--color-panel)] backdrop-blur-[var(--glass-blur)]",
          "transition-[transform,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:translate-x-0",
          collapsed ? "lg:w-16" : "lg:w-64"
        )}
        aria-label="主导航侧边栏"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border-light)] px-3">
          <span
            className={cn(
              "whitespace-nowrap text-xs font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]",
              "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
              collapsed
                ? "lg:pointer-events-none lg:-translate-x-2 lg:opacity-0"
                : "opacity-100"
            )}
          >
            工作空间
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] lg:hidden"
            aria-label="关闭侧边栏"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        <nav className="m-2 grid shrink-0 grid-cols-2 gap-1 rounded-[var(--radius-xl)] border border-[var(--color-border-light)] bg-[var(--color-surface)] p-1.5 lg:grid-cols-1">
          <button
            type="button"
            onClick={() => openSection("chat")}
            className={cn(
              "flex h-10 items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-sm font-medium",
              "transition-[background-color,color,box-shadow] duration-150",
              activeSection === "chat"
                ? "workbench-glow bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
              collapsed && "lg:justify-center lg:px-0"
            )}
            aria-current={activeSection === "chat" ? "page" : undefined}
            title={collapsed ? "展开聊天" : undefined}
          >
            <MessageSquare size={17} strokeWidth={1.8} className="shrink-0" />
            <span className={cn("whitespace-nowrap", collapsed && "lg:hidden")}>
              聊天
            </span>
          </button>
          <button
            type="button"
            onClick={() => openSection("projects")}
            className={cn(
              "flex h-10 items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-sm font-medium",
              "transition-[background-color,color,box-shadow] duration-150",
              activeSection === "projects"
                ? "workbench-glow bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
              collapsed && "lg:justify-center lg:px-0"
            )}
            aria-current={activeSection === "projects" ? "page" : undefined}
            title={collapsed ? "展开项目" : undefined}
          >
            <FolderOpen size={17} strokeWidth={1.8} className="shrink-0" />
            <span className={cn("whitespace-nowrap", collapsed && "lg:hidden")}>
              项目
            </span>
          </button>
        </nav>

        <div
          className={cn(
            "flex min-w-64 flex-1 flex-col overflow-hidden",
            "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
            collapsed
              ? "lg:pointer-events-none lg:-translate-x-3 lg:opacity-0"
              : "opacity-100"
          )}
          aria-hidden={collapsed && !mobileOpen}
          inert={collapsed && !mobileOpen ? true : undefined}
        >
          <div className="shrink-0 px-3 pb-3 pt-1">
            <Button
              type="button"
              onClick={createItem}
              variant="primary"
              size="md"
              className="w-full"
            >
              <Plus size={16} strokeWidth={2} />
              {activeSection === "chat" ? "新对话" : "新建项目"}
            </Button>
          </div>

          <div className="px-4 pb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
            {activeSection === "chat" ? "对话列表" : "项目列表"}
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {isLoading ? (
              <div className="space-y-1 px-2" role="status" aria-label="正在加载工作区列表">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-9 animate-pulse rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)]"
                  />
                ))}
              </div>
            ) : activeSection === "chat" ? (
              conversations.length > 0 ? (
                <div className="space-y-1">
                  {conversations.map((conversation) => (
                    <Link
                      key={conversation.id}
                      href={`/chat/${conversation.id}`}
                      onClick={onClose}
                      className={cn(
                        "group flex h-9 items-center gap-2 rounded-[var(--radius-md)] border px-2 text-sm",
                        "transition-[background-color,border-color,color] duration-150 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]",
                        activeConversationId === conversation.id
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                          : "border-transparent text-[var(--color-text-secondary)]"
                      )}
                    >
                      <MessageSquare
                        size={14}
                        strokeWidth={2}
                        className="shrink-0 opacity-70"
                      />
                      <span className="flex-1 truncate">{conversation.title}</span>
                      <button
                        type="button"
                        onClick={(event) =>
                          void deleteConversation(conversation.id, event)
                        }
                        className="shrink-0 rounded-[2px] p-0.5 opacity-0 transition-all duration-100 hover:bg-[var(--color-error-muted)] hover:text-[var(--color-error)] group-hover:opacity-100"
                        aria-label={`删除「${conversation.title}」`}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-8 text-center text-xs leading-5 text-[var(--color-text-tertiary)]">
                  暂无对话记录
                  <br />
                  点击「新对话」开始聊天
                </p>
              )
            ) : projects.length > 0 ? (
              <div className="space-y-1">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    onClick={onClose}
                    className={cn(
                      "flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border px-2 py-1.5 text-sm",
                      "transition-[background-color,border-color,color] duration-150 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]",
                      activeProjectId === project.id
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : "border-transparent text-[var(--color-text-secondary)]"
                    )}
                  >
                    <FolderOpen
                      size={14}
                      strokeWidth={2}
                      className="shrink-0 opacity-70"
                    />
                    <span className="truncate">{project.name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="px-2 py-8 text-center text-xs leading-5 text-[var(--color-text-tertiary)]">
                暂无项目
                <br />
                点击「新建项目」创建空间
              </p>
            )}
          </div>
        </div>

        <div
          className={cn(
            "shrink-0 border-t border-[var(--color-border-light)] px-4 py-2",
            "transition-opacity duration-200 ease-out motion-reduce:transition-none",
            collapsed && "lg:opacity-0"
          )}
        >
          <span className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
            DeepSeek V4
          </span>
        </div>
      </aside>
    </>
  );
}
