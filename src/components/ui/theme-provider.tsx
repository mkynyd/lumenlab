"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({
  children,
  initialTheme = "system",
}: {
  children: ReactNode;
  initialTheme?: string;
}) {
  const [theme, setThemeState] = useState<Theme>(
    initialTheme as Theme
  );
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  const applyTheme = useCallback((next: Theme) => {
    const resolved =
      next === "system" ? getSystemTheme() : (next as "light" | "dark");

    if (resolved === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Persist to cookie (for SSR) and localStorage
    document.cookie = `theme=${next};path=/;max-age=31536000;SameSite=Lax`;
    try {
      localStorage.setItem("theme", next);
    } catch {}

    setResolvedTheme(resolved);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      applyTheme(next);
    },
    [applyTheme]
  );

  // Sync on mount
  useEffect(() => {
    let stored: Theme = "system";
    try {
      const s = localStorage.getItem("theme");
      if (s === "light" || s === "dark" || s === "system") {
        stored = s;
      }
    } catch {}

    setThemeState(stored);
    applyTheme(stored);
  }, [applyTheme]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
