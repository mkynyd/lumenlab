import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("audit-learning-evidence script", () => {
  it("emits deterministic credential-free JSON", () => {
    const executable = join(
      process.cwd(),
      "node_modules",
      ".bin",
      "tsx",
    );
    const script = join(
      process.cwd(),
      "scripts",
      "audit-learning-evidence.ts",
    );
    const env = {
      ...process.env,
      DEEPSEEK_API_KEY: "sk-should-never-appear-in-audit",
      DATABASE_URL: "postgresql://audit-secret@localhost/private",
    };

    const first = execFileSync(executable, [script], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
    const second = execFileSync(executable, [script], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });

    expect(second).toBe(first);
    expect(JSON.parse(first)).toMatchObject({
      schemaVersion: "learning-freshness-audit-v1",
      total: 4,
      passed: 4,
      failed: 0,
      credentialFree: true,
    });
    expect(first).not.toContain("sk-should-never-appear-in-audit");
    expect(first).not.toContain("audit-secret");
    expect(first).not.toContain("DATABASE_URL");
  });
});
