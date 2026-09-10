import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      // next-auth/lib/env.js 以 ESM specifier 导入 "next/server"，而 Next 只在
      // exports map 里暴露 "./server.js"；显式映射一次，否则任何导入 next-auth
      // 的测试都会在 Vite 解析阶段失败。
      {
        find: /^next\/server$/,
        replacement: fileURLToPath(
          new URL("./node_modules/next/server.js", import.meta.url)
        ),
      },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./src/test/server-only.ts", import.meta.url)
        ),
      },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    server: {
      deps: {
        // next-auth 默认被外部化交给 Node ESM 解析，会绕开上面的
        // next/server 别名；内联后由 Vite 解析其依赖。
        inline: ["next-auth", "@auth/core"],
      },
    },
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.worktrees/**",
      "**/*.integration.test.ts",
    ],
  },
});
