import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "server-only": fileURLToPath(
          new URL("./src/test/server-only.ts", import.meta.url)
        ),
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.integration.test.ts"],
      fileParallelism: false,
      maxWorkers: 1,
      testTimeout: 20_000,
      hookTimeout: 20_000,
      env: environment.DATABASE_URL
        ? { DATABASE_URL: environment.DATABASE_URL }
        : {},
    },
  };
});
