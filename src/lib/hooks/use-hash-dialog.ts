"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Syncs a dialog's open state with a URL hash (e.g. #settings, #profile).
 * - opening pushes the hash (browser back closes the dialog via popstate)
 * - deep-linking: mounts open when the URL already carries the hash
 * - popstate drives open state both ways so history navigation feels native
 */
export function useHashDialog(
  hash: `#${string}`,
  open: boolean,
  setOpen: (open: boolean) => void
) {
  const pushedRef = useRef(false);
  const prevOpenRef = useRef(open);
  const setOpenRef = useRef(setOpen);

  // Keep the latest setOpen in a ref so stable listeners/mount effects can
  // call it without re-registering. Ref writes must happen in an effect.
  useEffect(() => {
    setOpenRef.current = setOpen;
  });

  // Deep link: open on mount when the URL already has our hash.
  useEffect(() => {
    if (window.location.hash === hash) {
      setOpenRef.current(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // open -> hash
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (open) {
      if (window.location.hash !== hash) {
        window.history.pushState(
          null,
          "",
          window.location.pathname + window.location.search + hash
        );
        pushedRef.current = true;
      }
    } else if (wasOpen && !pushedRef.current && window.location.hash === hash) {
      // Closed externally (e.g. mutual exclusion) — clear a stale hash in place.
      // Gated on a real true->false transition so the mount pass (initial
      // open=false) does not strip a deep-link hash before the deep-link
      // effect's setOpen(true) re-render lands.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }
  }, [open, hash]);

  // popstate -> open
  useEffect(() => {
    function handlePopState() {
      if (window.location.hash === hash) {
        pushedRef.current = true;
        setOpenRef.current(true);
      } else {
        pushedRef.current = false;
        setOpenRef.current(false);
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [hash]);

  const closeDialog = useCallback(() => {
    if (pushedRef.current && window.location.hash === hash) {
      pushedRef.current = false;
      // The popstate listener performs the actual close.
      window.history.back();
      return;
    }
    setOpen(false);
  }, [hash, setOpen]);

  return { closeDialog };
}
