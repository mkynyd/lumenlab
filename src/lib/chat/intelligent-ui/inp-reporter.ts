let started = false;

/**
 * Collect one page-level INP sample per visit, but only from pages that
 * actually rendered an intelligent UI surface. The metric is reported after
 * the page is hidden (web-vitals default), so slider interactions never issue
 * an extra request. Samples are anonymous and best-effort.
 */
export function startChatInpReporter() {
  if (
    started ||
    typeof window === "undefined" ||
    navigator.webdriver ||
    !navigator.sendBeacon ||
    !globalThis.crypto?.randomUUID
  ) {
    return;
  }
  started = true;

  void import("web-vitals")
    .then(({ onINP }) => {
      let previousMetricId: string | undefined;
      let visit: { id: string; day: string; screen: "narrow" | "wide" } | undefined;

      onINP(
        ({ id, value }) => {
          if (!visit || id !== previousMetricId) {
            previousMetricId = id;
            visit = {
              id: crypto.randomUUID(),
              day: new Date().toISOString().slice(0, 10),
              screen: window.matchMedia("(max-width: 767px)").matches ? "narrow" : "wide",
            };
          }
          navigator.sendBeacon(
            "/api/chat/metrics/inp",
            JSON.stringify({ ...visit, ms: Math.round(value) })
          );
        },
        { reportAllChanges: false }
      );
    })
    .catch(() => {
      started = false;
    });
}
