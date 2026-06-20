"use client";

import { useEffect } from "react";

function waitForImages() {
  return Promise.all(
    Array.from(document.images).map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    })
  );
}

function waitForMermaid() {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (!document.querySelector('[data-render-state="pending"]')) {
        resolve();
        return;
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}

export function ExportReadyMarker() {
  useEffect(() => {
    let cancelled = false;
    delete document.documentElement.dataset.exportReady;
    void (async () => {
      await document.fonts?.ready;
      await waitForImages();
      await waitForMermaid();
      if (!cancelled) {
        document.documentElement.dataset.exportReady = "true";
      }
    })();
    return () => {
      cancelled = true;
      delete document.documentElement.dataset.exportReady;
    };
  }, []);

  return null;
}
