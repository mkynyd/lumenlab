import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppOrigin } from "@/lib/app-origin";

describe("resolveAppOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the configured public origin over a reverse-proxy internal origin", () => {
    vi.stubEnv("AUTH_URL", "https://lab.mkynstudio.top/some/path");

    expect(resolveAppOrigin("https://localhost:3000")).toBe(
      "https://lab.mkynstudio.top"
    );
  });

  it("uses the request origin for local development when AUTH_URL is absent", () => {
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(resolveAppOrigin("http://localhost:3000/api/auth/verify/link")).toBe(
      "http://localhost:3000"
    );
  });

  it("fails closed when AUTH_URL is absent in production", () => {
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => resolveAppOrigin("https://localhost:3000")).toThrow(
      "AUTH_URL must be configured in production"
    );
  });

  it("rejects a non-HTTP(S) AUTH_URL", () => {
    vi.stubEnv("AUTH_URL", "file:///tmp/lumenlab");

    expect(() => resolveAppOrigin("http://localhost:3000")).toThrow(
      "AUTH_URL must be a valid HTTP(S) URL"
    );
  });
});
