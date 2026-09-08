"use client";

import { forwardRef, useState } from "react";
import { Bell } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNotifications } from "./notification-provider";
import { NotificationPanel } from "./notification-panel";

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center",
        "rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-medium leading-none",
        "text-[var(--color-accent-contrast)]"
      )}
      aria-hidden
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

interface TriggerButtonProps
  extends React.ComponentPropsWithoutRef<"button"> {
  unreadCount: number;
  open: boolean;
  size?: "md" | "sm";
}

/**
 * `asChild` 触发器的子元素必须把注入的 props/ref 透传到真实 DOM 节点，
 * 否则 Radix 的 onClick / aria 状态会丢失。
 */
const TriggerButton = forwardRef<HTMLButtonElement, TriggerButtonProps>(
  function TriggerButton({ unreadCount, open, size = "md", className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知"}
        className={cn(
          "relative inline-flex items-center justify-center rounded-[var(--radius-md)]",
          "text-[var(--color-text-secondary)] transition-[background-color,color,transform] duration-150",
          "hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]",
          "focus-visible:bg-[var(--color-interaction-active)] active:scale-[0.97]",
          "motion-reduce:transition-none",
          size === "md" ? "h-9 w-9" : "h-8 w-8",
          open && "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]",
          className
        )}
        {...rest}
      >
        <Bell size={17} strokeWidth={1.8} aria-hidden />
        <Badge count={unreadCount} />
      </button>
    );
  }
);

/**
 * 通知入口：桌面用 Popover，移动端用底部 Sheet。同一个 Provider 驱动所有入口，
 * 因此页面里出现多个铃铛时仍然只有一条订阅。
 */
export function NotificationBell({
  className,
  size = "md",
}: {
  className?: string;
  size?: "md" | "sm";
}) {
  const { unreadCount } = useNotifications();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // 移动端不提供通知入口：只保留顶部的胶囊提示，避免和悬浮导航争抢顶部空间。
  if (isMobile) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TriggerButton
          unreadCount={unreadCount}
          open={open}
          size={size}
          className={className}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[22rem] max-w-[calc(100vw-2rem)] p-2"
      >
        <NotificationPanel onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
