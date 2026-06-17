"use client";

import { useEffect, useState } from "react";
import { SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/layout/navbar";
import { Sidebar } from "@/components/layout/sidebar";
import { QueryProvider } from "@/components/providers/query-provider";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isProjectDetail = /^\/projects\/[^/]+$/.test(pathname);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isProjectDetail);

  useEffect(() => {
    if (!isProjectDetail) return;

    const timeoutId = window.setTimeout(() => {
      setSidebarCollapsed(true);
      setMobileSidebarOpen(false);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isProjectDetail, pathname]);

  function toggleSidebar() {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setSidebarCollapsed((current) => !current);
      return;
    }

    setMobileSidebarOpen((current) => !current);
  }

  return (
    <SessionProvider>
      <QueryProvider>
        <div className="h-screen flex flex-col bg-[var(--color-bg)]">
          <Navbar
            sidebarCollapsed={sidebarCollapsed}
            onMenuToggle={toggleSidebar}
          />
          <div className="flex-1 flex overflow-hidden">
            <Sidebar
              mobileOpen={mobileSidebarOpen}
              collapsed={sidebarCollapsed}
              onClose={() => setMobileSidebarOpen(false)}
              onExpand={() => setSidebarCollapsed(false)}
            />
            <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg)]">
              {children}
            </main>
          </div>
        </div>
      </QueryProvider>
    </SessionProvider>
  );
}
