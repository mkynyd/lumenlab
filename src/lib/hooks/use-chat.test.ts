import { describe, expect, it } from "vitest";
import { readChatError } from "./use-chat";

describe("readChatError", () => {
  it("falls back to the HTTP status when an error response has no body", async () => {
    await expect(readChatError(new Response(null, { status: 500 }))).resolves.toBe(
      "Request failed (500)"
    );
  });

  it("uses JSON error bodies when they are present", async () => {
    await expect(
      readChatError(Response.json({ error: "模型服务不可用" }, { status: 502 }))
    ).resolves.toBe("模型服务不可用");
  });
});
