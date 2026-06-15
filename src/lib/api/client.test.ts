import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/api/client";

describe("fetchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns typed JSON for successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ value: 42 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(fetchJson<{ value: number }>("/api/value")).resolves.toEqual({
      value: 42,
    });
  });

  it("surfaces string API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "请求失败" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(fetchJson("/api/value")).rejects.toThrow("请求失败");
  });

  it("surfaces field validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { name: ["名称不能为空"] } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(fetchJson("/api/value")).rejects.toThrow("名称不能为空");
  });
});
