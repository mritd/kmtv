import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        url: "http://localhost:3000/",
      },
    },
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Thresholds ratchet up after each frontend-review wave to prevent coverage regression.
      // Wave 1 actual: 82.07 / 73.42 / 75.89 / 80.57. Wave 2 actual: 83.49 / 74.68 / 78.49 / 82.38.
      // Wave 3 actual: 89.51 / 80.05 / 85.77 / 88.34.
      //
      // 每完成一波 frontend-review 后阈值收紧, 防止覆盖率回退.
      thresholds: {
        lines: 89,
        branches: 80,
        functions: 85,
        statements: 88,
      },
      exclude: [
        // Type-only declaration files contribute no executable lines.
        //
        // 仅类型声明文件无可执行行.
        "src/env.d.ts",
        "src/**/*.d.ts",
        "src/i18n/i18next.d.ts",
        // App entry boots React and is exercised end-to-end, not by unit tests.
        //
        // App 入口由端到端用例覆盖.
        "src/main.tsx",
        // Test helpers are not production code.
        //
        // 测试辅助代码不计入覆盖率.
        "src/test/**",
        // ArtPlayer wrapper relies on real DOM/HLS; it cannot be exercised in happy-dom.
        //
        // ArtPlayer 包装依赖真实 DOM/HLS, happy-dom 无法执行.
        "src/player/VideoPlayer.tsx",
        // Skeletons are pure presentational stubs with no branching.
        //
        // Skeleton 仅是占位 UI, 无分支逻辑.
        "src/**/skeletons/**",
        // Animation helpers use declarative motion objects and browser capability checks.
        // Focused tests cover their behavior; aggregate coverage excludes the directory.
        //
        // 动画 helper 包含声明式 motion 对象和浏览器能力检查.
        // 其行为由专项测试覆盖, aggregate coverage 不统计该目录.
        "src/animation/**",
        // Importing i18n runs its bootstrap side effect, so tests exercise it indirectly.
        //
        // import i18n 会触发初始化副作用, 因此测试会间接执行该模块.
        "src/i18n/index.ts",
      ],
    },
  },
});
