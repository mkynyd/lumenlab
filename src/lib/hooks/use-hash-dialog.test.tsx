import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHashDialog } from "@/lib/hooks/use-hash-dialog";

function setup(hash: `#${string}`) {
  return renderHook(() => {
    const [open, setOpen] = useState(false);
    const { closeDialog } = useHashDialog(hash, open, setOpen);
    return { open, setOpen, closeDialog };
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/chat");
  vi.restoreAllMocks();
});

describe("useHashDialog", () => {
  it("pushes the hash into the URL when the dialog opens", () => {
    const { result } = setup("#profile");
    act(() => result.current.setOpen(true));
    expect(window.location.hash).toBe("#profile");
  });

  it("opens on mount when the URL already carries the hash (deep link)", () => {
    window.history.replaceState(null, "", "/chat#settings");
    const { result } = setup("#settings");
    expect(result.current.open).toBe(true);
  });

  it("closeDialog uses history.back() when this hook pushed the hash", () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result } = setup("#profile");
    act(() => result.current.setOpen(true));
    act(() => result.current.closeDialog());
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("closes when popstate reports the hash is gone", () => {
    const { result } = setup("#profile");
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    act(() => {
      window.history.replaceState(null, "", "/chat");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.open).toBe(false);
  });

  it("opens when popstate navigates back to its hash", () => {
    const { result } = setup("#settings");
    expect(result.current.open).toBe(false);
    act(() => {
      window.history.replaceState(null, "", "/chat#settings");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.open).toBe(true);
  });

  it("closeDialog on a deep-linked dialog clears the hash in place without history.back()", () => {
    window.history.replaceState(null, "", "/chat#profile");
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result } = setup("#profile");
    expect(result.current.open).toBe(true);
    act(() => result.current.closeDialog());
    expect(backSpy).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
    expect(window.location.hash).toBe("");
  });
});
