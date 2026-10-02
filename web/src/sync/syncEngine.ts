/**
 * sync/syncEngine.ts — push-then-pull sync cycles for one signed-in scope.
 *
 * sync/syncEngine.ts — 单个已登录作用域的 "先推送再拉取" 同步流程.
 *
 * Responsibilities / 职责:
 *   - Run one cycle at a time, coalescing requests made while a cycle runs — 同一时间只运行一轮, 合并运行期间的请求
 *   - Debounce local changes; throttle watch pushes and page-entry syncs — 本地修改防抖; 观看记录推送和页面进入同步限频
 *   - Handle epoch resets, restores, full resyncs, retries, and lost sessions — 处理 epoch 重置, 旧副本恢复, 全量重同步, 重试和会话失效
 *   - Never touch the store after stop(), even when a request was in flight — stop() 之后不再修改存储, 即使请求仍在进行
 *
 * Shared verbatim with android/src/sync/. Platform code is injected through the options.
 *
 * 与 android/src/sync/ 逐字共享. 平台相关代码通过参数注入.
 *
 * ADR refs: ADR-016 (unified offline-first sync)
 */
import type { SyncStore } from "./syncStore";
import {
  applyPullPage,
  applyPushResults,
  collectChanges,
  finishFullResync,
  markForReupload,
  resetForNewEpoch,
  type CollectOptions,
  type PushInvalid,
} from "./syncMerge";
import type { LocalRecord, SyncKind, SyncPullResponse, SyncPushRequest, SyncPushResponse } from "./types";

/**
 * SyncReason labels why a cycle was requested; only "page" is throttled.
 *
 * SyncReason 标记请求同步的原因; 只有 "page" 会被限频.
 */
export type SyncReason = "launch" | "login" | "foreground" | "online" | "page" | "player" | "change" | "retry";

/**
 * SyncErrorKind is how a platform classifies a failed request for the engine. "conflict" is any
 * HTTP 409 from push (epoch mismatch or cursor ahead); the following pull resolves both.
 *
 * SyncErrorKind 是平台对失败请求的分类, 供引擎决定后续处理. "conflict" 指推送返回的任何
 * HTTP 409 (epoch 不一致或游标超前); 随后的拉取会处理这两种情况.
 */
export type SyncErrorKind = "unauthorized" | "conflict" | "retry";

/**
 * SyncTransport sends sync requests through the platform API client.
 *
 * SyncTransport 通过平台的 API 客户端发送同步请求.
 */
export interface SyncTransport {
  push(body: SyncPushRequest, options: { keepalive: boolean }): Promise<SyncPushResponse>;
  pull(params: { since: number; epoch: string; limit: number }): Promise<SyncPullResponse>;
}

/**
 * SYNC_PAGE_MIN_INTERVAL_MS is the minimum gap between page-entry syncs.
 *
 * SYNC_PAGE_MIN_INTERVAL_MS 是页面进入触发同步的最小间隔.
 */
export const SYNC_PAGE_MIN_INTERVAL_MS = 30_000;

/**
 * SYNC_CHANGE_DEBOUNCE_MS is the delay between a local change and its push.
 *
 * SYNC_CHANGE_DEBOUNCE_MS 是本地修改到推送之间的延迟.
 */
export const SYNC_CHANGE_DEBOUNCE_MS = 2_000;

/**
 * SYNC_WATCH_PUSH_INTERVAL_MS is the minimum gap between pushes caused by playback checkpoints.
 *
 * SYNC_WATCH_PUSH_INTERVAL_MS 是播放进度触发推送的最小间隔.
 */
export const SYNC_WATCH_PUSH_INTERVAL_MS = 30_000;

/**
 * SYNC_RETRY_MIN_MS is the first retry delay after a failed cycle.
 *
 * SYNC_RETRY_MIN_MS 是同步失败后的首次重试延迟.
 */
export const SYNC_RETRY_MIN_MS = 2_000;

/**
 * SYNC_RETRY_MAX_MS caps the exponential retry delay.
 *
 * SYNC_RETRY_MAX_MS 是指数退避重试延迟的上限.
 */
export const SYNC_RETRY_MAX_MS = 300_000;

/**
 * SYNC_KEEPALIVE_MAX_BYTES bounds a background flush; browsers cap keepalive bodies at 64 KiB.
 *
 * SYNC_KEEPALIVE_MAX_BYTES 限制退到后台时补写的大小; 浏览器将 keepalive 请求体限制在 64 KiB.
 */
export const SYNC_KEEPALIVE_MAX_BYTES = 60 * 1024;

/**
 * SYNC_PULL_LIMIT is the page size of each pull request.
 *
 * SYNC_PULL_LIMIT 是每次拉取请求的分页大小.
 */
export const SYNC_PULL_LIMIT = 500;

const MAX_PUSH_ROUNDS = 20;

const KEEPALIVE_COLLECT: CollectOptions = { maxBytes: SYNC_KEEPALIVE_MAX_BYTES, newestFirst: true };

// STOPPED aborts a cycle whose engine was stopped while a request was in flight.
//
// STOPPED 用于中止请求进行期间引擎已被停止的同步流程.
const STOPPED = new Error("sync engine stopped");

/**
 * SyncEngine runs sync cycles for one store.
 *
 * SyncEngine 为一个存储运行同步流程.
 */
export interface SyncEngine {
  requestSync(reason: SyncReason): Promise<void>;
  flushNow(options?: { keepalive?: boolean }): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * SyncEngineOptions wires the engine to the transport, the store, and platform callbacks.
 *
 * SyncEngineOptions 将引擎连接到传输层, 存储和平台回调.
 */
export interface SyncEngineOptions {
  transport: SyncTransport;
  classifyError(error: unknown): SyncErrorKind;
  store: SyncStore;
  now?: () => number;
  runExclusive?: (task: () => Promise<void>) => Promise<void>;
  onLimit?: (rejected: LocalRecord[]) => void;
  onUnauthorized?: () => void;
}

/**
 * createSyncEngine builds an engine that is active immediately; stop() pauses it and start() resumes.
 *
 * createSyncEngine 创建立即可用的引擎; stop() 暂停, start() 恢复.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { transport, store, classifyError } = options;
  const now = options.now ?? (() => Date.now());
  const runExclusive = options.runExclusive ?? ((task: () => Promise<void>) => task());
  let stopped = false;
  let running: Promise<void> | null = null;
  let flushing: Promise<void> | null = null;
  let rerun = false;
  let lastCycleAt = Number.NEGATIVE_INFINITY;
  let lastPushAt = Number.NEGATIVE_INFINITY;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let pushDeadline = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = SYNC_RETRY_MIN_MS;
  let unsubscribe: (() => void) | null = store.onLocalChange(schedulePush);

  function clearTimers(): void {
    if (pushTimer !== null) clearTimeout(pushTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    pushTimer = null;
    retryTimer = null;
  }

  function schedulePush(kind: SyncKind): void {
    // A pending retry pushes this change too; a debounce timer would only bypass the backoff.
    //
    // 等待中的重试也会推送这次修改; 再设防抖定时器只会绕过退避.
    if (stopped || retryTimer !== null) return;
    const delay =
      kind === "watch"
        ? Math.max(SYNC_CHANGE_DEBOUNCE_MS, lastPushAt + SYNC_WATCH_PUSH_INTERVAL_MS - now())
        : SYNC_CHANGE_DEBOUNCE_MS;
    const deadline = now() + delay;
    if (pushTimer !== null) {
      if (pushDeadline <= deadline) return;
      clearTimeout(pushTimer);
    }
    pushDeadline = deadline;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void requestSync("change");
    }, delay);
  }

  function checkStopped(): void {
    if (stopped) throw STOPPED;
  }

  function reportInvalid(invalid: PushInvalid[]): void {
    for (const { record, reason } of invalid) {
      console.warn("sync change rejected as invalid", record.kind, record.key, reason);
    }
  }

  function handleError(error: unknown): void {
    if (stopped) return;
    if (classifyError(error) === "unauthorized") {
      stop();
      options.onUnauthorized?.();
      return;
    }
    if (retryTimer !== null) clearTimeout(retryTimer);
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, SYNC_RETRY_MAX_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void requestSync("retry");
    }, delay);
  }

  // pushPending returns false on a conflict (new epoch, or a cursor ahead of a restored server);
  // the following pull then reports the reset. A keepalive flush sends one small batch, newest first.
  //
  // 冲突 (新 epoch, 或游标超前于已恢复的服务端) 时 pushPending 返回 false; 随后的拉取会报告
  // 重置. keepalive 补写只发送一小批, 最新的优先.
  async function pushPending(keepalive: boolean): Promise<boolean> {
    for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
      const state = store.state();
      const batch = collectChanges(state, keepalive ? KEEPALIVE_COLLECT : {});
      if (batch.changes.length === 0) return true;
      const sentAt = now();
      let response: SyncPushResponse;
      try {
        response = await transport.push(
          { epoch: state.epoch, cursor: state.cursor, changes: batch.changes },
          { keepalive },
        );
      } catch (error) {
        checkStopped();
        if (classifyError(error) === "conflict") return false;
        throw error;
      }
      checkStopped();
      store.clock.observe(response.server_time_ms, sentAt, now());
      let rejected: LocalRecord[] = [];
      let invalid: PushInvalid[] = [];
      store.update((current) => {
        const outcome = applyPushResults(current, batch, response);
        rejected = outcome.rejected;
        invalid = outcome.invalid;
        return { ...outcome.state, clockOffsetMs: store.clock.offsetMs() };
      });
      lastPushAt = now();
      reportInvalid(invalid);
      if (rejected.length > 0) options.onLimit?.(rejected);
      if (keepalive) return true;
    }
    return true;
  }

  // pullAll returns false after the server lost data this device has (a new epoch, or a same-epoch
  // reset whose rev is below the cursor: a restore from an older copy); the records are re-marked
  // and the cycle pushes them. Any other same-epoch reset is a full resync that may drop unseen
  // records; a first pull from cursor 0 must keep records this device just pushed.
  //
  // 服务端丢失本设备已有数据时 (新 epoch, 或同 epoch 且 rev 低于游标的 reset, 即从旧副本恢复),
  // pullAll 重新标记记录并返回 false, 由本轮流程推送. 其他同 epoch 的 reset 是可以删除未出现记录
  // 的全量重同步; 从游标 0 开始的首次拉取必须保留本设备刚推送的记录.
  async function pullAll(): Promise<boolean> {
    let seen = new Set<string>();
    let full = false;
    let resets = 0;
    for (;;) {
      const state = store.state();
      const sentAt = now();
      const page = await transport.pull({ since: state.cursor, epoch: state.epoch, limit: SYNC_PULL_LIMIT });
      checkStopped();
      store.clock.observe(page.server_time_ms, sentAt, now());
      if (page.reset) {
        if (state.epoch !== "" && page.epoch !== state.epoch) {
          store.update((current) => resetForNewEpoch(current, page.epoch, store.username));
          return false;
        }
        if (page.rev < state.cursor) {
          store.update((current) => markForReupload(current));
          return false;
        }
        resets += 1;
        if (resets > 1) throw new Error("sync pull asked for a reset twice");
        store.update((current) => ({ ...current, cursor: 0 }));
        seen = new Set();
        full = true;
        continue;
      }
      store.update((current) => ({
        ...applyPullPage(current, page, seen),
        username: store.username,
        clockOffsetMs: store.clock.offsetMs(),
      }));
      if (!page.has_more) break;
    }
    if (full) store.update((current) => finishFullResync(current, seen));
    return true;
  }

  async function cycle(): Promise<void> {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    // Another writer (a browser tab) may have synced while this cycle waited for the lock.
    //
    // 本轮等待锁期间, 其他写入方 (浏览器的另一个标签页) 可能已经同步过.
    store.reload();
    try {
      for (let attempt = 0; attempt < 3 && !stopped; attempt += 1) {
        const pushed = await pushPending(false);
        const pulled = await pullAll();
        if (pushed && pulled) break;
      }
      lastCycleAt = now();
      retryDelay = SYNC_RETRY_MIN_MS;
    } catch (error) {
      handleError(error);
    }
  }

  function requestSync(reason: SyncReason): Promise<void> {
    if (stopped) return Promise.resolve();
    // A page entry joins a running cycle instead of queueing another one.
    //
    // 页面进入时若已有同步在运行, 直接复用它, 不再排队新的一轮.
    if (reason === "page" && (running || now() - lastCycleAt < SYNC_PAGE_MIN_INTERVAL_MS)) {
      return running ?? Promise.resolve();
    }
    if (running) {
      rerun = true;
      return running;
    }
    const loop = async () => {
      do {
        rerun = false;
        await runExclusive(cycle);
      } while (rerun && !stopped);
    };
    running = loop().finally(() => {
      running = null;
    });
    return running;
  }

  async function flush(keepalive: boolean): Promise<void> {
    try {
      // A conflict means the server reset or was restored; only a full cycle can resolve it, and
      // the flush waits for it so a caller (logout, a source switch) knows the data left.
      //
      // 冲突说明服务端被重置或从旧副本恢复, 只有完整的一轮同步能处理; 补写会等待这一轮,
      // 让调用方 (退出登录, 切换来源) 知道数据已经发出.
      if (!(await pushPending(keepalive))) await requestSync("retry");
    } catch (error) {
      handleError(error);
    }
  }

  // flushNow is single-flight: a flush requested while one runs shares its result. A keepalive
  // flush always sends its own batch: the page is going away, and the running flush's request may
  // be cancelled with it.
  //
  // flushNow 同一时间只运行一次: 运行期间再次请求会共享当前结果. keepalive 补写总是发送自己的
  // 一批: 页面即将离开, 正在进行的补写请求可能随之被取消.
  function flushNow(flushOptions: { keepalive?: boolean } = {}): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pushTimer !== null) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    if (flushOptions.keepalive) return flush(true);
    if (flushing) return flushing;
    flushing = flush(false).finally(() => {
      flushing = null;
    });
    return flushing;
  }

  function start(): void {
    stopped = false;
    unsubscribe ??= store.onLocalChange(schedulePush);
  }

  function stop(): void {
    stopped = true;
    clearTimers();
    unsubscribe?.();
    unsubscribe = null;
  }

  return { requestSync, flushNow, start, stop };
}
