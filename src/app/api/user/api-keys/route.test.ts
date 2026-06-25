import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  apiKeyUpsert: vi.fn(),
  configEnabled: false,
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    apiKey: {
      upsert: mocks.apiKeyUpsert,
    },
  },
}));

vi.mock("@/lib/config", () => ({
  get USER_API_KEYS_ENABLED() {
    return mocks.configEnabled;
  },
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: (value: string) => `encrypted-${value}`,
  maskApiKey: (value: string) => `masked-${value.slice(-4)}`,
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/user/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/user/api-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configEnabled = false;
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.apiKeyUpsert.mockResolvedValue({
      id: "key-1",
      provider: "deepseek",
      keyPrefix: "masked-xxxx",
    });
  });

  it("returns 403 when USER_API_KEYS_ENABLED is false", async () => {
    mocks.configEnabled = false;
    const response = await POST(makeRequest({ provider: "deepseek", apiKey: "sk-xxx" }));
    expect(response.status).toBe(403);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("未启用");
    expect(mocks.apiKeyUpsert).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.configEnabled = true;
    mocks.auth.mockResolvedValue(null);
    const response = await POST(makeRequest({ provider: "deepseek", apiKey: "sk-xxx" }));
    expect(response.status).toBe(401);
    expect(mocks.apiKeyUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid provider", async () => {
    mocks.configEnabled = true;
    const response = await POST(
      makeRequest({ provider: "openai", apiKey: "sk-xxx" })
    );
    expect(response.status).toBe(400);
    expect(mocks.apiKeyUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 for empty api key", async () => {
    mocks.configEnabled = true;
    const response = await POST(makeRequest({ provider: "deepseek", apiKey: "" }));
    expect(response.status).toBe(400);
    expect(mocks.apiKeyUpsert).not.toHaveBeenCalled();
  });

  it("encrypts and upserts the api key when enabled", async () => {
    mocks.configEnabled = true;
    const response = await POST(makeRequest({ provider: "deepseek", apiKey: "sk-abc123" }));
    expect(response.status).toBe(200);

    const data = (await response.json()) as { provider: string; keyPrefix: string };
    expect(data.provider).toBe("deepseek");
    expect(data.keyPrefix).toBe("masked-c123");

    expect(mocks.apiKeyUpsert).toHaveBeenCalledWith({
      where: { userId_provider: { userId: "user-1", provider: "deepseek" } },
      create: {
        userId: "user-1",
        provider: "deepseek",
        encryptedKey: "encrypted-sk-abc123",
        keyPrefix: "masked-c123",
      },
      update: {
        encryptedKey: "encrypted-sk-abc123",
        keyPrefix: "masked-c123",
      },
    });
  });
});
