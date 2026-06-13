"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { Navbar } from "@/components/layout/navbar";
import { Sidebar } from "@/components/layout/sidebar";
import { cn } from "@/lib/utils";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <SessionProvider>
      <div className="h-screen flex flex-col">
        <Navbar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg)]">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
