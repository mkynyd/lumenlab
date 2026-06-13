"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Trash2, X } from "lucide-react";

interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchConversations();
  }, []);

  async function fetchConversations() {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // 静默处理
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (pathname === `/chat/${id}`) {
          router.push("/chat");
        }
      }
    } catch {
      // 静默处理
    }
  }

  function newChat() {
    router.push("/chat");
    onClose();
  }

  const activeId = pathname.startsWith("/chat/") ? pathname.split("/").pop() : null;

  return (
    <>
      {/* 移动端遮罩 */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50",
          "w-64 flex flex-col",
          "bg-[var(--color-surface)] border-r border-[var(--color-border)]",
          "transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between h-12 px-4 border-b border-[var(--color-border)] shrink-0">
          <span className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
            对话列表
          </span>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            aria-label="关闭侧边栏"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* 新建对话按钮 */}
        <div className="p-3 shrink-0">
          <Button
            onClick={newChat}
            variant="primary"
            size="md"
            className="w-full"
          >
            <Plus size={16} strokeWidth={2} />
            新对话
          </Button>
        </div>

        {/* 对话列表 */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="对话列表">
          {isLoading ? (
            <div className="space-y-1 px-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-9 rounded-[var(--radius-md)] bg-[var(--color-surface-hover)] animate-pulse"
                />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-[var(--color-text-tertiary)]">
              暂无对话记录
              <br />
              点击「新对话」开始聊天
            </p>
          ) : (
            <div className="space-y-0.5">
              {conversations.map((conv) => (
                <Link
                  key={conv.id}
                  href={`/chat/${conv.id}`}
                  onClick={onClose}
                  className={cn(
                    "group flex items-center gap-2 px-2 h-9 rounded-[var(--radius-md)]",
                    "text-sm transition-colors duration-100",
                    "hover:bg-[var(--color-surface-hover)]",
                    activeId === conv.id
                      ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)]"
                  )}
                >
                  <MessageSquare
                    size={14}
                    strokeWidth={2}
                    className="shrink-0 opacity-70"
                  />
                  <span className="flex-1 truncate">{conv.title}</span>
                  <button
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className={cn(
                      "shrink-0 p-0.5 rounded-[2px]",
                      "opacity-0 group-hover:opacity-100",
                      "hover:bg-[var(--color-error-muted)] hover:text-[var(--color-error)]",
                      "transition-all duration-100"
                    )}
                    aria-label={`删除「${conv.title}」`}
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </Link>
              ))}
            </div>
          )}
        </nav>

        {/* 底部模型标识 */}
        <div className="px-4 py-2 border-t border-[var(--color-border)] shrink-0">
          <span className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider font-medium">
            DeepSeek V4
          </span>
        </div>
      </aside>
    </>
  );
}
