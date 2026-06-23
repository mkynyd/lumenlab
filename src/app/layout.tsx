import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import { cn } from "@/lib/utils";

const figtree = localFont({
  src: [
    { path: "../../fonts/Figtree/static/Figtree-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../fonts/Figtree/static/Figtree-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../fonts/Figtree/static/Figtree-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../fonts/Figtree/static/Figtree-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  applicationName: "LumenLab",
  title: {
    default: "LumenLab",
    template: "%s · LumenLab",
  },
  description: "面向大学计算机课程的 AI 实验工作台、资料整理与成果导出工具。",
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "LumenLab",
    title: "LumenLab",
    description: "AI 对话、项目资料管理、文档解析与学习成果导出工作台。",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={cn("h-full", "antialiased", "font-sans", figtree.variable)}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--color-bg)] text-[var(--color-text-primary)]">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
