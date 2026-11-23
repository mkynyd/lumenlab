type SurfaceModule = typeof import("./surface");
let surfaceLoad: Promise<SurfaceModule> | undefined;
let loadedSurface: SurfaceModule["default"] | undefined;

export function loadSurface() {
  return surfaceLoad ??= import("./surface").then(
    (module) => {
      loadedSurface = module.default;
      return module;
    },
    (error) => {
      surfaceLoad = undefined;
      throw error;
    },
  );
}

export const getLoadedSurface = () => loadedSurface;
export const loadChart = () => import("./chart");

export function preloadSurface() {
  void loadSurface().catch(() => {});
}
