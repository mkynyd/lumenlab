import { describe, expect, it } from "vitest";
import { PaperServiceError } from "@/lib/paper/service";
import { researchErrorResponse } from "./http";

describe("researchErrorResponse", () => {
  it.each([
    ["NOT_FOUND", 404],
    ["INVALID_STATE", 409],
    ["INVALID_INPUT", 400],
  ] as const)("maps PaperServiceError %s to HTTP %d", async (code, status) => {
    const response = researchErrorResponse(new PaperServiceError(code, "paper error"));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: "paper error", code });
  });
});
