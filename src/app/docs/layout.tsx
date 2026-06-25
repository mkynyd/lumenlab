"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--color-bg)]">
      <div className="relative flex flex-1 overflow-hidden">
        <DocsSidebar
          mobileOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6 md:px-10 lg:py-3 lg:pl-64">
          <div className="mb-4 lg:hidden">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMobileSidebarOpen(true)}
              className="h-9 gap-2 px-3 text-[13px]"
            >
              <Menu size={16} strokeWidth={2} />
              文档目录
            </Button>
          </div>
          {children}
        </main>
        <div
          className={cn(
            "fixed inset-0 z-20 bg-[var(--color-overlay)] transition-opacity duration-200 lg:hidden",
            mobileSidebarOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          )}
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden={!mobileSidebarOpen}
        />
      </div>
    </div>
  );
}
