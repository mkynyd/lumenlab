import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ErrorReporter } from "@/components/feedback/error-reporter";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const figtree = localFont({
  src: [
    { path: "../../fonts/Figtree/static/Figtree-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../fonts/Figtree/static/Figtree-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../fonts/Figtree/static/Figtree-SemiBold.ttf", weight: "600", style: "normal" },
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
  description: "面向大学计算机课程的学习工具，把资料、对话和导出放在一起。",
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "LumenLab",
    title: "LumenLab",
    description: "LumenLab 是一个 AI 学习工作台，帮大学生管理课程资料、辅助理解、导出成果。",
  },
  robots: {
    index: false,
    follow: false,
  },
};

// `dvh` keeps the workbench above Safari's dynamic browser chrome; this enables
// the matching safe-area CSS used by the mobile composer.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
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
          <TooltipProvider>
            {children}
            <ErrorReporter />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
