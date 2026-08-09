import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, fetchJson } from "@/lib/api/client";

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

  it("surfaces structured API error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "idempotency_conflict",
              message: "请求内容与已有幂等记录不一致",
            },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );

    await expect(fetchJson("/api/value")).rejects.toThrow(
      "请求内容与已有幂等记录不一致"
    );
  });
});

describe("errorMessage", () => {
  it("extracts the first message from flattened zod fieldErrors", () => {
    // 向导批量保存快捷任务时服务端返回的 400 形状
    const payload = {
      error: { actions: ["标题不能超过 20 个字符"] },
    };
    expect(errorMessage(payload, "快捷任务保存失败")).toBe(
      "标题不能超过 20 个字符"
    );
  });

  it("returns string errors unchanged", () => {
    expect(errorMessage({ error: "保存失败" }, "兜底")).toBe("保存失败");
  });

  it("falls back for non-payloads instead of rendering [object Object]", () => {
    expect(errorMessage(null, "快捷任务保存失败")).toBe("快捷任务保存失败");
    expect(errorMessage({ error: {} }, "快捷任务保存失败")).toBe(
      "快捷任务保存失败"
    );
    expect(errorMessage("服务器错误", "快捷任务保存失败")).toBe(
      "快捷任务保存失败"
    );
  });
});
