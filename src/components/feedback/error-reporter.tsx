"use client";

import { useEffect, useRef } from "react";

/** 全局错误静默上报：同一错误（message + stack 首行）每个组件实例只报一次。 */
export function ErrorReporter() {
  const reportedRef = useRef(new Set<string>());

  useEffect(() => {
    const reported = reportedRef.current;

    const report = (message: string, stack?: string) => {
      if (!message) return;
      const key = `${message}|${stack?.split("\n")[0] ?? ""}`;
      if (reported.has(key)) return;
      reported.add(key);
      fetch("/api/errors/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.slice(0, 500),
          stack: stack?.slice(0, 4000),
          route: window.location.pathname,
        }),
        keepalive: true,
      }).catch(() => {
        // 上报失败一律静默，绝不影响用户
      });
    };

    const onError = (event: globalThis.ErrorEvent) => {
      report(
        event.message,
        event.error instanceof Error ? event.error.stack : undefined
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report(
        reason instanceof Error ? reason.message : String(reason),
        reason instanceof Error ? reason.stack : undefined
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
