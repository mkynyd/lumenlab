"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/layout/navbar";
import { Sidebar } from "@/components/layout/sidebar";
import { QueryProvider } from "@/components/providers/query-provider";
import { cn } from "@/lib/utils";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const section = pathname.startsWith("/projects")
    ? "projects"
    : pathname.startsWith("/tools")
      ? "tools"
      : "chat";
  const isInsideProject = /^\/projects\/[^/]+/.test(pathname || "");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState(false);
  // 项目页把整个主导航让给项目资料栏；离开后恢复用户在其他工作区的偏好。
  const sidebarCollapsed = isInsideProject || userCollapsed;

  function toggleSidebar() {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      if (isInsideProject) return;
      setUserCollapsed((current) => !current);
      return;
    }

    setMobileSidebarOpen((current) => !current);
  }

  return (
    <SessionProvider>
      <QueryProvider>
        <a
          href="#workbench-main"
          className={cn(
            "sr-only focus:not-sr-only",
            "fixed left-2 top-2 z-[100]",
            "rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 py-2",
            "text-sm font-medium text-[var(--color-accent-contrast)]",
            "focus:outline-none focus-visible:outline-none"
          )}
        >
          跳到主内容
        </a>
        <div className="flex h-dvh min-h-svh flex-col bg-[var(--color-bg)]">
          <Navbar
            sidebarCollapsed={sidebarCollapsed}
            desktopSidebarLocked={isInsideProject}
            mobileSidebarOpen={mobileSidebarOpen}
            onMenuToggle={toggleSidebar}
          />
          <div className="flex-1 flex overflow-hidden">
            <Sidebar
              mobileOpen={mobileSidebarOpen}
              collapsed={sidebarCollapsed}
              hiddenOnDesktop={isInsideProject}
              onClose={() => setMobileSidebarOpen(false)}
              onExpand={() => {
                if (isInsideProject) return;
                setUserCollapsed(false);
              }}
            />
            <main
              key={section}
              id="workbench-main"
              className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg)] workbench-view-enter"
            >
              {children}
            </main>
          </div>
        </div>
      </QueryProvider>
    </SessionProvider>
  );
}
