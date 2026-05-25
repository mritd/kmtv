/**
 * env.d.ts — ambient type declarations for the Vite client environment.
 * env.d.ts — Vite 客户端环境的环境类型声明文件.
 *
 * The triple-slash reference injects Vite's built-in type definitions, which include:
 *   - import.meta.env (MODE, BASE_URL, PROD, DEV, SSR and custom VITE_* vars)
 *   - CSS / asset module types (*.css, *.svg, *.png, ...)
 *   - Glob import types (import.meta.glob)
 * 三斜线引用注入 Vite 内置类型定义, 包括:
 *   - import.meta.env (MODE、BASE_URL、PROD、DEV、SSR 及自定义 VITE_* 变量)
 *   - CSS / 资产模块类型 (*.css、*.svg、*.png 等)
 *   - Glob 导入类型 (import.meta.glob)
 *
 * This file is a declaration-only file — no executable code, no imports.
 * 此文件是纯声明文件 — 无可执行代码, 无 import.
 * It is excluded from vitest coverage (see vitest.config.ts coverage.exclude).
 * 已从 vitest 覆盖率中排除 (见 vitest.config.ts coverage.exclude).
 */

/// <reference types="vite/client" />
