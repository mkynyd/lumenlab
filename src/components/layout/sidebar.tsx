"use client";

import { useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { ProfileDialog } from "@/components/user/profile-dialog";
import { useHashDialog } from "@/lib/hooks/use-hash-dialog";
import { AvatarMark } from "@/components/user/avatar-mark";
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
  PageEdit,
  Plus,
  Trash,
  Xmark,
} from "iconoir-react";
import {
  BarChart3,
  ChevronDown,
  LogOut,
  PanelLeftClose,
  Settings,
  UserRound,
} from "lucide-react";
import {
  useConversations,
  useDeleteConversation,
} from "@/lib/hooks/use-conversations";
import { useDeleteProject, useProjects } from "@/lib/hooks/use-projects";
import {
  useConversions,
  useDeleteConversion,
} from "@/lib/hooks/use-conversions";
import { DEFAULT_AVATAR_PRESET } from "@/lib/user-profile";

interface SidebarProps {
  mobileOpen: boolean;
  collapsed: boolean;
  hiddenOnDesktop?: boolean;
  onClose: () => void;
  onExpand: () => void;
  onCollapse?: () => void;
}

export function Sidebar({
  mobileOpen,
  collapsed,
  hiddenOnDesktop = false,
  onClose,
  onExpand,
  onCollapse,
}: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const activeSection = pathname.startsWith("/projects")
    ? "projects"
    : pathname.startsWith("/tools")
      ? "tools"
      : pathname.startsWith("/usage")
        ? "usage"
        : "chat";
  const conversationsQuery = useConversations();
  const projectsQuery = useProjects();
  const conversionsQuery = useConversions();
  const deleteConversationMutation = useDeleteConversation();
  const deleteProjectMutation = useDeleteProject();
  const deleteConversionMutation = useDeleteConversion();
  // 两个 useHashDialog 的声明顺序影响互斥切换时的 strip/push 时序：
  // 先声明者的 effect 先执行（先清旧 hash 再 push 新 hash），不要调换。
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { closeDialog: closeSettingsDialog } = useHashDialog(
    "#settings",
    settingsOpen,
    setSettingsOpen
  );
  const { closeDialog: closeProfileDialog } = useHashDialog(
    "#profile",
    profileOpen,
    setProfileOpen
  );
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountPointerHandledRef = useRef(false);
  const [conversationDeleteTarget, setConversationDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [conversionDeleteTarget, setConversionDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const conversations = conversationsQuery.data || [];
  const projects = projectsQuery.data || [];
  const conversions = conversionsQuery.data || [];
  const isLoading =
    activeSection === "chat"
      ? conversationsQuery.isPending
      : activeSection === "projects"
        ? projectsQuery.isPending
        : conversionsQuery.isPending;

  async function deleteConversation(id: string) {
    await deleteConversationMutation.mutateAsync(id);
    if (pathname === `/chat/${id}`) router.push("/chat");
  }

  async function deleteProject(id: string) {
    await deleteProjectMutation.mutateAsync(id);
    if (pathname === `/projects/${id}`) router.push("/projects");
  }

  async function deleteConversion(id: string) {
    try {
      await deleteConversionMutation.mutateAsync(id);
      if (pathname === `/tools/${id}`) router.push("/tools");
      setConversionDeleteTarget(null);
    } catch {
      // Mutation state keeps the confirmation dialog open with a retry message.
    }
  }

  function requestDeleteConversion(conversion: { id: string; title: string }) {
    deleteConversionMutation.reset();
    setConversionDeleteTarget(conversion);
  }

  function openSection(section: "chat" | "projects" | "tools") {
    onExpand();
    onClose();
    if (section === "chat") router.push("/chat");
    else if (section === "projects") router.push("/projects");
    else router.push("/tools");
  }

  function createItem() {
    onClose();
    if (activeSection === "tools") {
      router.push("/tools");
      return;
    }
    router.push(activeSection === "chat" ? "/chat" : "/projects/new");
  }

  function openAccountSurface(surface: "profile" | "settings") {
    setAccountMenuOpen(false);
    onClose();
    if (surface === "profile") {
      setSettingsOpen(false);
      setProfileOpen(true);
      return;
    }
    setProfileOpen(false);
    setSettingsOpen(true);
  }

  const activeConversationId = pathname.startsWith("/chat/")
    ? pathname.split("/").pop()
    : null;
  const activeProjectId = pathname.startsWith("/projects/")
    ? pathname.split("/")[2]
    : null;
  const activeConversionId = pathname.startsWith("/tools/")
    ? pathname.split("/")[2]
    : null;
  const accountName =
    session?.user?.name || session?.user?.email || "账户";
  const accountEmail = session?.user?.email || "";
  const accountAvatarPreset =
    session?.user?.avatarPreset || DEFAULT_AVATAR_PRESET;
  const accountAvatarUrl = session?.user?.image || null;

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
          "fixed inset-0 z-40 bg-[var(--color-overlay)] transition-opacity duration-300 ease-out lg:hidden motion-reduce:transition-none",
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
          "border-r border-[var(--color-border-light)] bg-[var(--sidebar)]",
          "transition-[transform,width,opacity,visibility] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none",
          mobileOpen
            ? "visible translate-x-0"
            : "invisible -translate-x-full",
          "lg:static lg:translate-x-0",
          hiddenOnDesktop
            ? "lg:invisible lg:pointer-events-none lg:w-0 lg:border-r-0 lg:opacity-0"
            : collapsed
              ? "lg:visible lg:w-16"
              : "lg:visible lg:w-64"
        )}
        aria-label="主导航侧边栏"
      >
        <SidebarHeader className="flex h-[52px] shrink-0 flex-row items-center justify-between px-3 py-0">
          <Link
            href="/chat"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-0 items-center rounded-[var(--radius-sm)] text-sm font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent)]"
            aria-label="LumenLab 首页"
          >
            <span className={cn("truncate", collapsed && "lg:hidden")}>LumenLab</span>
            <span className={cn("hidden text-sm", collapsed && "lg:inline")}>L</span>
          </Link>
          {!collapsed && onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="hidden h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)] active:scale-[0.97] lg:inline-flex"
              aria-label="收起侧边栏"
              aria-expanded="true"
            >
              <PanelLeftClose size={17} strokeWidth={1.8} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] lg:hidden"
            aria-label="关闭侧边栏"
          >
            <Xmark width={15} height={15} strokeWidth={2} />
          </button>
        </SidebarHeader>

        <SidebarGroup className="mx-2 mb-1 mt-1 w-auto shrink-0 p-0">
          <SidebarMenu aria-label="工作空间导航" className="gap-0.5">
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                onClick={() => openSection("chat")}
                isActive={activeSection === "chat"}
                className={cn("h-11 font-normal lg:h-9", collapsed && "lg:justify-center lg:px-0")}
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
                className={cn("h-11 font-normal lg:h-9", collapsed && "lg:justify-center lg:px-0")}
                aria-current={activeSection === "projects" ? "page" : undefined}
                title={collapsed ? "展开项目" : undefined}
              >
                <Folder strokeWidth={1.8} />
                <span className={cn("whitespace-nowrap", collapsed && "lg:hidden")}>
                  项目
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                onClick={() => openSection("tools")}
                isActive={activeSection === "tools"}
                className={cn("h-11 font-normal lg:h-9", collapsed && "lg:justify-center lg:px-0")}
                aria-current={activeSection === "tools" ? "page" : undefined}
                title={collapsed ? "展开转换" : undefined}
              >
                <PageEdit strokeWidth={1.8} />
                <span className={cn("whitespace-nowrap", collapsed && "lg:hidden")}>
                  转换
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Link href="/usage" onClick={onClose}>
                <SidebarMenuButton
                  type="button"
                  isActive={activeSection === "usage"}
                  className={cn("h-11 w-full font-normal lg:h-9", collapsed && "lg:justify-center lg:px-0")}
                  aria-current={activeSection === "usage" ? "page" : undefined}
                  title={collapsed ? "用量统计" : undefined}
                >
                  <BarChart3 strokeWidth={1.8} size={20} />
                  <span className={cn("whitespace-nowrap", collapsed && "lg:hidden")}>
                    用量
                  </span>
                </SidebarMenuButton>
              </Link>
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
          <SidebarGroup className="shrink-0 px-2 pb-2 pt-1">
            <Button
              type="button"
              onClick={createItem}
              variant="ghost"
              size="md"
              className="h-9 w-full justify-start rounded-[var(--radius-md)] px-2 font-normal"
            >
              <Plus data-icon="inline-start" strokeWidth={2} />
              {activeSection === "chat"
                ? "新对话"
                : activeSection === "tools"
                  ? "新转换"
                  : "新建项目"}
            </Button>
          </SidebarGroup>

          <SidebarGroupLabel className="h-7 px-4 pb-1 text-[11px] font-normal uppercase tracking-[0.06em]">
            {activeSection === "chat"
              ? "最近对话"
              : activeSection === "tools"
                ? "最近转换"
                : "最近项目"}
          </SidebarGroupLabel>

          <SidebarContent className="flex-1 px-2 pb-1">
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
                <SidebarMenu className="gap-0.5">
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
            ) : activeSection === "tools" ? (
              conversions.length > 0 ? (
                <SidebarMenu className="gap-0.5">
                  {conversions.map((conversion) => (
                    <ContextMenu key={conversion.id}>
                      <ContextMenuTrigger asChild>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            asChild
                            isActive={activeConversionId === conversion.id}
                            className="min-h-10"
                          >
                            <Link href={`/tools/${conversion.id}`} onClick={onClose}>
                              <PageEdit strokeWidth={2} />
                              <span>{conversion.title}</span>
                            </Link>
                          </SidebarMenuButton>
                          <SidebarMenuAction
                            type="button"
                            showOnHover
                            onClick={(event) => {
                              event.stopPropagation();
                              requestDeleteConversion(conversion);
                            }}
                            className="hover:text-destructive"
                            aria-label={`删除「${conversion.title}」`}
                          >
                            <Trash strokeWidth={2} />
                          </SidebarMenuAction>
                        </SidebarMenuItem>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="min-w-36">
                        <ContextMenuItem
                          onSelect={() => {
                            onClose();
                            router.push(`/tools/${conversion.id}`);
                          }}
                        >
                          <PageEdit strokeWidth={2} />
                          查看内容
                        </ContextMenuItem>
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => requestDeleteConversion(conversion)}
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
                  暂无转换记录
                  <br />
                  上传 PDF 开始转换
                </p>
              )
            ) : projects.length > 0 ? (
              <SidebarMenu className="gap-0.5">
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
            "shrink-0 px-2 pb-2 pt-1",
            "transition-opacity duration-200 ease-out motion-reduce:transition-none",
            collapsed ? "lg:px-2" : "lg:px-3"
          )}
        >
          <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "relative z-10 flex h-11 w-full min-w-0 items-center justify-start gap-2 rounded-[var(--radius-md)] px-2 text-left lg:h-10",
                  "text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
                  collapsed && "lg:w-11 lg:justify-center lg:px-0"
                )}
                aria-label="打开个人与设置"
                aria-haspopup="menu"
                data-dropdown-menu-trigger
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  accountPointerHandledRef.current = true;
                  setAccountMenuOpen((prev) => !prev);
                  event.currentTarget.focus();
                }}
                onClick={() => {
                  if (accountPointerHandledRef.current) {
                    accountPointerHandledRef.current = false;
                    return;
                  }
                  setAccountMenuOpen((prev) => !prev);
                }}
              >
                <AvatarMark
                  presetId={accountAvatarPreset}
                  src={accountAvatarUrl}
                  alt={`${accountName} 的头像`}
                  className="size-7"
                />
                <span
                  className={cn(
                    "block min-w-0 flex-1",
                    collapsed && "lg:hidden"
                  )}
                >
                  <span className="block truncate text-xs font-medium text-[var(--color-text-primary)]">
                    {accountName}
                  </span>
                  <span className="block truncate text-xs text-[var(--color-text-tertiary)]">
                    {accountEmail || "账户设置"}
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
              side={mobileOpen ? "top" : "right"}
              align="end"
              className="w-48"
            >
              <DropdownMenuItem
                onSelect={() => openAccountSurface("profile")}
              >
                <UserRound size={14} strokeWidth={2} />
                个人资料
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => openAccountSurface("settings")}
              >
                <Settings size={14} strokeWidth={2} />
                设置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setAccountMenuOpen(false);
                  onClose();
                  void signOut({ callbackUrl: "/login" });
                }}
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
        <AlertDialog
          open={conversionDeleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && !deleteConversionMutation.isPending) {
              setConversionDeleteTarget(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除转换记录</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除「{conversionDeleteTarget?.title}」吗？已保存到项目的文件不会受到影响。
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteConversionMutation.isError && (
              <p className="text-sm text-[var(--color-error)]" role="alert">
                删除失败，请稍后重试。
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteConversionMutation.isPending}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteConversionMutation.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  if (conversionDeleteTarget) {
                    void deleteConversion(conversionDeleteTarget.id);
                  }
                }}
              >
                {deleteConversionMutation.isPending && (
                  <Spinner data-icon="inline-start" />
                )}
                {deleteConversionMutation.isPending ? "正在删除" : "删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog
          open={settingsOpen}
          onOpenChange={(next) => {
            // 防御性：受控 Dialog 不会自行触发 open=true，此处兜底互斥。
            if (next) {
              setProfileOpen(false);
              setSettingsOpen(true);
            } else {
              closeSettingsDialog();
            }
          }}
        >
          <DialogContent className="inset-0 h-dvh max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-none [&>[data-slot=dialog-close]]:right-[max(0.5rem,env(safe-area-inset-right))] [&>[data-slot=dialog-close]]:top-[max(0.5rem,env(safe-area-inset-top))] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:h-auto sm:max-w-[960px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px] sm:pb-0 sm:pt-0 sm:[&>[data-slot=dialog-close]]:right-2 sm:[&>[data-slot=dialog-close]]:top-2">
            <DialogTitle className="sr-only">设置</DialogTitle>
            <SettingsPanel />
          </DialogContent>
        </Dialog>
        <ProfileDialog
          open={profileOpen}
          onOpenChange={(next) => {
            // 防御性：受控 Dialog 不会自行触发 open=true，此处兜底互斥。
            if (next) {
              setSettingsOpen(false);
              setProfileOpen(true);
            } else {
              closeProfileDialog();
            }
          }}
        />
      </aside>
    </SidebarProvider>
  );
}
