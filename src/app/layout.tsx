import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";

export const metadata: Metadata = {
  title: "Light AI Chat",
  description: "Industrial-grade AI chat. Bring your own DeepSeek key.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const themeClass = themeCookie === "dark" ? "dark" : "";

  return (
    <html
      lang="zh-CN"
      className={`${themeClass} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Prevent FOUC: apply theme class before render */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--color-bg)] text-[var(--color-text-primary)]">
        <ThemeProvider initialTheme={themeCookie || "system"}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
