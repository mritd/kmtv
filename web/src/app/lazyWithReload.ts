/**
 * lazyWithReload — React.lazy wrapper with one-shot stale-chunk recovery via page reload.
 * lazyWithReload — 带有一次性陈旧 chunk 恢复的 React.lazy 包装器, 通过页面刷新恢复.
 *
 * Problem / 问题:
 *   After a server rebuild the asset hashes change. A still-open browser tab holds stale
 *   import() URLs that 404 when evaluated, leaving users on a blank screen.
 *   服务端重建后资产哈希改变. 仍打开的浏览器标签页持有已过时的 import() URL,
 *   执行时会 404, 导致用户看到白屏.
 *
 * Solution / 解决方案:
 *   On the first chunk load failure, set a sessionStorage flag and do a full page reload
 *   so the browser fetches the new asset manifest. The flag prevents an infinite reload
 *   loop if the chunk is genuinely absent (not just stale).
 *   在首次 chunk 加载失败时, 设置 sessionStorage 标志并执行完整页面刷新,
 *   使浏览器获取新的资产清单. 该标志防止 chunk 真正缺失时 (非过时) 无限刷新.
 *
 * TIER 4 LOCKED — retry count (1), reload mechanism, and RELOAD_FLAG key must not change.
 * Changing these would break the loop-guard invariant and risk an infinite reload cycle.
 * TIER 4 锁定 — 重试次数 (1)、刷新机制和 RELOAD_FLAG key 不得修改.
 * 修改会破坏循环防护不变量, 可能导致无限刷新循环.
 *
 * Key exports / 主要导出:
 *   lazyWithReload
 *
 * Callers / 调用方:
 *   AppRoutes.tsx — wraps every route-level dynamic import()
 */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// sessionStorage flag prevents an infinite reload loop when the chunk is genuinely missing (not just stale).
// sessionStorage
// 标志位防止真正缺失的 chunk 导致无限刷新.
const RELOAD_FLAG = "kmtv.chunk-reload";

// CHUNK_ERROR_PATTERNS matches the user-visible chunk-load failures from Vite/webpack/Rollup runtimes.
// CHUNK_ERROR_PATTERNS
// 匹配 Vite/webpack/Rollup 运行时常见的 chunk 加载失败.
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk \d+ failed/i,
  /ChunkLoadError/i,
];

function isChunkError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && error !== null && "name" in error && (error as { name?: string }).name === "ChunkLoadError") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * lazyWithReload wraps React.lazy to recover from stale chunk URLs via a one-shot full
 * page reload, rather than surfacing a blank screen to the user.
 * lazyWithReload 包裹 React.lazy, 通过一次性整页刷新从陈旧 chunk URL 中恢复,
 * 而不是向用户显示白屏.
 *
 * After a reload, a successful chunk fetch clears the RELOAD_FLAG so subsequent deploys
 * can also recover (the guard only blocks consecutive reload attempts, not future ones).
 * 刷新后, 成功的 chunk 加载会清除 RELOAD_FLAG, 以便未来的部署也能恢复
 * (防护仅阻止连续的刷新尝试, 而非未来的首次失败).
 */
export function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory()
      .then((mod) => {
        // A successful load clears the loop guard so future stale-chunk events can also recover.
        // 成功加载后清除标志位, 让未来再次发生时仍可恢复.
        try {
          window.sessionStorage.removeItem(RELOAD_FLAG);
        } catch {
          // sessionStorage may be unavailable (e.g. file://); not a problem here.
          // sessionStorage
          // 不可用时直接忽略.
        }
        return mod;
      })
      .catch((error: unknown) => {
        if (!isChunkError(error)) {
          throw error;
        }
        let alreadyReloaded = "";
        try {
          alreadyReloaded = window.sessionStorage.getItem(RELOAD_FLAG) ?? "";
        } catch {
          // Same fallback as above.
          // 同上, 静默失败.
        }
        if (alreadyReloaded) {
          // We already reloaded once;
          // surfacing the error lets ErrorBoundaries / network panel show it instead of looping.
          // 已经刷新过一次, 让错误显式抛出, 避免循环.
          throw error;
        }
        try {
          window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        } catch {
          // If we cannot persist the flag, still attempt the reload — risk of a loop is acceptable vs blank page.
          // 即便无法保存标志位, 仍然尝试刷新, 比白屏更可接受.
        }
        window.location.reload();
        // Return a never-resolving promise so React stays in Suspense fallback until the reload kicks in.
        // 返回永不 resolve 的 Promise, 让 React 一直停留在 Suspense fallback 直到刷新生效.
        return new Promise<{ default: T }>(() => undefined);
      }),
  );
}
