import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), key: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/data/provider-access", () => ({ getProviderApiKey: mocks.key }));
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
  mocks.key.mockResolvedValue("secret-not-for-response");
  vi.stubEnv("MODEL_QWEN_ENABLED", "true");
  vi.stubEnv("BAILIAN_WORKSPACE_ID", "workspace");
});
afterEach(() => vi.unstubAllEnvs());

describe("chat model availability", () => {
  it("lists Qwen first when enabled and configured, without exposing credentials", async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toEqual({ models: ["qwen3.8-flash", "deepseek-flash", "minimax-m3"], defaultModel: "qwen3.8-flash", unavailableReasons: {} });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(data)).not.toContain("secret-not-for-response");
  });
  it("keeps the configured default when the flag is off and explains unavailability", async () => {
    vi.stubEnv("MODEL_QWEN_ENABLED", "false");
    const data = await (await GET()).json();
    expect(data.defaultModel).toBe("qwen3.8-flash");
    expect(data.models).not.toContain(data.defaultModel);
    expect(data.unavailableReasons[data.defaultModel]).toContain("暂未开放");
    expect(mocks.key).not.toHaveBeenCalled();
  });
  it("explains a missing workspace", async () => {
    vi.stubEnv("BAILIAN_WORKSPACE_ID", "");
    const data = await (await GET()).json();
    expect(data.models).not.toContain("qwen3.8-flash");
    expect(data.unavailableReasons["qwen3.8-flash"]).toContain("工作空间");
  });
  it("explains inaccessible credentials without exposing upstream errors", async () => {
    mocks.key.mockRejectedValue(new Error("private credential details"));
    const data = await (await GET()).json();
    expect(data.models).not.toContain("qwen3.8-flash");
    expect(data.unavailableReasons["qwen3.8-flash"]).toContain("聊天凭证");
    expect(JSON.stringify(data)).not.toContain("private credential details");
  });
});
