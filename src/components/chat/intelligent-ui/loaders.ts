export const loadSurface = () => import("./surface");
export const loadChart = () => import("./chart");

export function preloadSurface() {
  void loadSurface().catch(() => {});
}
