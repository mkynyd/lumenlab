import { describe, expect, it } from "vitest";
import { resolveAgentRuntimeMode } from "./runtime-mode";

describe("resolveAgentRuntimeMode", () => {
  it("uses the same legacy default in development and production", () => {
    expect(resolveAgentRuntimeMode({ NODE_ENV: "development" })).toBe("legacy");
    expect(resolveAgentRuntimeMode({ NODE_ENV: "production" })).toBe("legacy");
  });

  it("accepts every explicit rollout mode", () => {
    expect(resolveAgentRuntimeMode({ AGENT_RUNTIME_MODE: "legacy" })).toBe("legacy");
    expect(resolveAgentRuntimeMode({ AGENT_RUNTIME_MODE: "shadow" })).toBe("shadow");
    expect(resolveAgentRuntimeMode({ AGENT_RUNTIME_MODE: "new" })).toBe("new");
  });

  it("maps the legacy orchestrator flag without consulting NODE_ENV", () => {
    expect(resolveAgentRuntimeMode({ AGENT_ORCHESTRATOR_ENABLED: "0" })).toBe("legacy");
    expect(resolveAgentRuntimeMode({ AGENT_ORCHESTRATOR_ENABLED: "1" })).toBe("new");
  });

  it("rejects an invalid explicit mode instead of silently drifting", () => {
    expect(() => resolveAgentRuntimeMode({ AGENT_RUNTIME_MODE: "preview" })).toThrow(
      "Invalid AGENT_RUNTIME_MODE"
    );
  });
});
