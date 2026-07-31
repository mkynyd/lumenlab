// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  flags: {
    apiEnabled: false,
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: mocks.flags,
}));

import {
  learningRoute,
  parseStrictJson,
} from "@/lib/learning/server/http";

describe("learning route boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flags.apiEnabled = false;
  });

  it("fails closed before authentication and handler execution", async () => {
    const handler = vi.fn();

    const response = await learningRoute(handler);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "learning_disabled" },
    });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects unknown JSON fields at the shared boundary", async () => {
    const parsed = await parseStrictJson(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "attempt-1",
          assistanceLevel: "independent",
        }),
      }),
      z
        .object({
          idempotencyKey: z.string().min(1),
        })
        .strict()
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.response.status).toBe(400);
      await expect(parsed.response.json()).resolves.toMatchObject({
        error: { code: "invalid_state" },
      });
    }
  });
});
