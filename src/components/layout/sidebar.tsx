"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPanel } from "@/components/settings/settings-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  ChatLines,
  Folder,
  Plus,
  Trash,
  Xmark,
} from "iconoir-react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import {
  useConversations,
  useDeleteConversation,
} from "@/lib/hooks/use-conversations";
import { useDeleteProject, useProjects } from "@/lib/hooks/use-projects";

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
  const { data: session } = useSession();
  const activeSection = pathname.startsWith("/projects") ? "projects" : "chat";
  const conversationsQuery = useConversations();
  const projectsQuery = useProjects();
  const deleteConversationMutation = useDeleteConversation();
  const deleteProjectMutation = useDeleteProject();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversationDeleteTarget, setConversationDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const conversations = conversationsQuery.data || [];
  const projects = projectsQuery.data || [];
  const isLoading =
    conversationsQuery.isPending || projectsQuery.isPending;

  async function deleteConversation(id: string) {
    await deleteConversationMutation.mutateAsync(id);
    if (pathname === `/chat/${id}`) router.push("/chat");
  }

  async function deleteProject(id: string) {
    await deleteProjectMutation.mutateAsync(id);
    if (pathname === `/projects/${id}`) router.push("/projects");
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
  const accountName =
    session?.user?.name || session?.user?.email || "账户";
  const accountInitial = accountName.trim().slice(0, 1).toUpperCase() || "A";

  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => {
        if (open) onExpand();
      }}
      className="contents"
    >
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
        <SidebarHeader className="flex h-14 shrink-0 flex-row items-center justify-between px-3 py-0">
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
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] lg:hidden"
            aria-label="关闭侧边栏"
          >
            <Xmark width={15} height={15} strokeWidth={2} />
          </button>
        </SidebarHeader>

        <SidebarGroup className="mx-2 my-2 w-auto shrink-0 rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-1.5">
          <SidebarMenu className="grid min-w-0 grid-cols-2 gap-1 lg:grid-cols-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                onClick={() => openSection("chat")}
                isActive={activeSection === "chat"}
                className={cn("h-10", collapsed && "lg:justify-center lg:px-0")}
                aria-current={activeSection === "chat" ? "page" : undefined}
                title={collapsed ? "展开聊天" : undefined}
              >
                <ChatLines strokeWidth={1.8} />
                <span className={cn("whitespace-nowrap", collapsed && "lg:hidden")}>
                  聊天
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                onClick={() => openSection("projects")}
                isActive={activeSection === "projects"}
                className={cn("h-10", collapsed && "lg:justify-center lg:px-0")}
                aria-current={activeSection === "projects" ? "page" : undefined}
                title={collapsed ? "展开项目" : undefined}
              >
                <Folder strokeWidth={1.8} />
                <span className={cn("whitespace-nowrap", collapsed && "lg:hidden")}>
                  项目
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

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
          <SidebarGroup className="shrink-0 px-3 pb-3 pt-1">
            <Button
              type="button"
              onClick={createItem}
              variant="primary"
              size="md"
              className="w-full"
            >
              <Plus data-icon="inline-start" strokeWidth={2} />
              {activeSection === "chat" ? "新对话" : "新建项目"}
            </Button>
          </SidebarGroup>

          <SidebarGroupLabel className="px-4 pb-2 text-[11px] uppercase tracking-wider">
            {activeSection === "chat" ? "对话列表" : "项目列表"}
          </SidebarGroupLabel>

          <SidebarContent className="flex-1 px-2 pb-2">
            {isLoading ? (
              <div className="flex flex-col gap-1 px-2" role="status" aria-label="正在加载工作区列表">
                {[1, 2, 3].map((item) => (
                  <Skeleton
                    key={item}
                    className="h-9 rounded-[var(--radius-md)]"
                  />
                ))}
              </div>
            ) : activeSection === "chat" ? (
              conversations.length > 0 ? (
                <SidebarMenu className="gap-1">
                  {conversations.map((conversation) => (
                    <ContextMenu key={conversation.id}>
                      <ContextMenuTrigger asChild>
                        <SidebarMenuItem>
                          <SidebarMenuButton asChild isActive={activeConversationId === conversation.id}>
                            <Link href={`/chat/${conversation.id}`} onClick={onClose}>
                              <ChatLines strokeWidth={2} />
                              <span>{conversation.title}</span>
                            </Link>
                          </SidebarMenuButton>
                          <SidebarMenuAction
                            type="button"
                            showOnHover
                            onClick={(event) => {
                              event.stopPropagation();
                              setConversationDeleteTarget(conversation);
                            }}
                            className="hover:text-destructive"
                            aria-label={`删除「${conversation.title}」`}
                          >
                            <Trash strokeWidth={2} />
                          </SidebarMenuAction>
                        </SidebarMenuItem>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="min-w-36">
                        <ContextMenuItem
                          onSelect={() => {
                            onClose();
                            router.push(`/chat/${conversation.id}`);
                          }}
                        >
                          <ChatLines strokeWidth={2} />
                          打开对话
                        </ContextMenuItem>
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => setConversationDeleteTarget(conversation)}
                        >
                          <Trash strokeWidth={2} />
                          删除
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </SidebarMenu>
              ) : (
                <p className="px-2 py-8 text-center text-xs leading-5 text-[var(--color-text-tertiary)]">
                  暂无对话记录
                  <br />
                  点击「新对话」开始聊天
                </p>
              )
            ) : projects.length > 0 ? (
              <SidebarMenu className="gap-1">
                {projects.map((project) => (
                  <ContextMenu key={project.id}>
                    <ContextMenuTrigger asChild>
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive={activeProjectId === project.id} className="min-h-10">
                          <Link href={`/projects/${project.id}`} onClick={onClose}>
                            <Folder strokeWidth={2} />
                            <span>{project.name}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-36">
                      <ContextMenuItem
                        onSelect={() => {
                          onClose();
                          router.push(`/projects/${project.id}`);
                        }}
                      >
                        <Folder strokeWidth={2} />
                        打开项目
                      </ContextMenuItem>
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => setProjectDeleteTarget(project)}
                      >
                        <Trash strokeWidth={2} />
                        删除
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </SidebarMenu>
            ) : (
              <p className="px-2 py-8 text-center text-xs leading-5 text-[var(--color-text-tertiary)]">
                暂无项目
                <br />
                点击「新建项目」创建空间
              </p>
            )}
          </SidebarContent>
        </div>

        <SidebarFooter
          className={cn(
            "shrink-0 px-2 py-2",
            "transition-opacity duration-200 ease-out motion-reduce:transition-none",
            collapsed ? "lg:px-2" : "lg:px-3"
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-11 w-full min-w-0 items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-surface)] px-2 text-left",
                  "text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
                  collapsed && "lg:justify-center lg:px-0"
                )}
                aria-label="打开账户菜单"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-xs font-semibold text-[var(--color-accent)]">
                  {accountInitial}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    collapsed && "lg:hidden"
                  )}
                >
                  <span className="block truncate text-xs font-medium text-[var(--color-text-primary)]">
                    {accountName}
                  </span>
                  <span className="block truncate text-[10px] text-[var(--color-text-tertiary)]">
                    DeepSeek V4
                  </span>
                </span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={cn("shrink-0", collapsed && "lg:hidden")}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="end"
              className="w-48 workbench-border-glow"
            >
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings size={14} strokeWidth={2} />
                设置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void signOut({ callbackUrl: "/login" })}
              >
                <LogOut size={14} strokeWidth={2} />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
        <AlertDialog
          open={conversationDeleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setConversationDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除对话</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除「{conversationDeleteTarget?.title}」吗？这条对话记录将无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (conversationDeleteTarget) {
                    void deleteConversation(conversationDeleteTarget.id);
                    setConversationDeleteTarget(null);
                  }
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={projectDeleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setProjectDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除项目</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除「{projectDeleteTarget?.name}」吗？相关文件和对话将被一并删除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (projectDeleteTarget) {
                    void deleteProject(projectDeleteTarget.id);
                    setProjectDeleteTarget(null);
                  }
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-[min(920px,calc(100vw-2rem))] p-0 sm:max-w-[920px]">
            <DialogHeader className="border-b border-[var(--color-border-light)] px-5 py-4">
              <DialogTitle>设置</DialogTitle>
              <DialogDescription>
                管理服务访问、缓存、外观和账户。
              </DialogDescription>
            </DialogHeader>
            <div className="px-5 py-4">
              <SettingsPanel compact />
            </div>
          </DialogContent>
        </Dialog>
      </aside>
    </SidebarProvider>
  );
}
