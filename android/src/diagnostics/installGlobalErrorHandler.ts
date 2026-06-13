// Install once: forward console.error + ErrorUtils.setGlobalHandler into the error log.
// 一次性安装: 将 console.error 与 ErrorUtils.setGlobalHandler 转发至错误日志.

import { appendErrorEntry } from "./errorLog";

let installed = false;

/**
 * Reset the install guard for tests. NEVER call from production.
 * 仅供测试重置安装标志, 生产路径不得调用.
 */
export function __resetInstallGuard(): void {
  installed = false;
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * Patch console.error + ErrorUtils.setGlobalHandler to capture entries into errorLog.
 * RN 0.85 declares ErrorUtils in globals.d.ts so no @ts-expect-error is required;
 * the typeof guard keeps this safe to import from non-RN contexts (tests, scripts).
 * 修补 console.error 与 ErrorUtils.setGlobalHandler 将错误转发至 errorLog.
 * RN 0.85 在 globals.d.ts 已声明 ErrorUtils, 无需 @ts-expect-error;
 * typeof 守卫保证非 RN 环境 (如脚本) 引入此模块也不会抛 ReferenceError.
 */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  installed = true;

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    try {
      const message = args
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safeStringify(a)))
        .join(" ");
      const stack = args.find((a) => a instanceof Error) as Error | undefined;
      appendErrorEntry({
        ts: Date.now(),
        source: "console",
        message,
        stack: stack?.stack,
      });
    /* istanbul ignore next — defensive catch; never let logging logging break logging. */
    } catch {
      // swallow
    }
    originalConsoleError.apply(console, args);
  };

  if (typeof ErrorUtils !== "undefined") {
    const previous = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((err: Error, isFatal?: boolean) => {
      try {
        appendErrorEntry({
          ts: Date.now(),
          source: "global",
          message: `${err.name}: ${err.message}${isFatal ? " [fatal]" : ""}`,
          stack: err.stack,
        });
      /* istanbul ignore next — defensive catch, see console.error wrapper above. */
      } catch {
        // swallow
      }
      previous?.(err, isFatal);
    });
  }
}
