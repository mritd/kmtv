/**
 * sync/syncClock.ts — server-aligned, strictly increasing event clock for sync writes.
 *
 * sync/syncClock.ts — 以服务器时间为基准且严格递增的同步事件时钟.
 *
 * Event times from all devices follow server time, so last-writer-wins compares like with like.
 * Monotonicity is per record: callers pass the time the new event must beat. There is no global
 * high-water mark, so one bad server observation cannot push every later write into the future.
 *
 * 所有设备的事件时间都以服务器时间为基准, 让 "时间新的胜出" 规则比较的是同一把尺子.
 * 单调性按记录保证: 调用方传入新事件必须超过的时间. 没有全局最大值, 一次错误的服务端时间
 * 观测不会把之后所有写入都推到未来.
 *
 * Shared verbatim with android/src/sync/. Import only sibling modules here.
 *
 * 与 android/src/sync/ 逐字共享. 这里只能导入同目录模块.
 */

/**
 * SyncClock issues event times and learns the server offset from responses.
 *
 * SyncClock 生成事件时间, 并从响应中学习与服务器的时间差.
 */
export interface SyncClock {
  next(after?: number): number;
  observe(serverTimeMs: number, sentAtMs: number, receivedAtMs: number): void;
  offsetMs(): number;
}

/**
 * createSyncClock builds a clock starting from a persisted offset.
 *
 * createSyncClock 以持久化的时间差为起点创建时钟.
 */
export function createSyncClock(initialOffsetMs = 0, now: () => number = Date.now): SyncClock {
  let offset = Number.isFinite(initialOffsetMs) ? initialOffsetMs : 0;
  return {
    next(after = 0) {
      return Math.max(Math.round(now() + offset), after + 1);
    },
    observe(serverTimeMs, sentAtMs, receivedAtMs) {
      if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0 || receivedAtMs < sentAtMs) return;
      offset = Math.round(serverTimeMs - (sentAtMs + receivedAtMs) / 2);
    },
    offsetMs: () => offset,
  };
}
