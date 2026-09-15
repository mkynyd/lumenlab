import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 上面的 ".next/**" 只匹配根级目录，匹配不到嵌套的 worktree。每个 worktree
    // 都会带一份自己的 .next 产物，漏掉这里会让 eslint 扫进十几万条构建噪声。
    // test 脚本已用 --exclude '.worktrees/**' 排除同一目录，这里与之对齐。
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
