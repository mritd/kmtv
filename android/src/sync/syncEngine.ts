/**
 * sync/syncEngine.ts — push-then-pull sync cycles for one signed-in scope.
 *
 * sync/syncEngine.ts — 单个已登录作用域的 "先推送再拉取" 同步流程.
 *
 * Responsibilities / 职责:
 *   - Run one cycle at a time, coalescing requests made while a cycle runs — 同一时间只运行一轮, 合并运行期间的请求
 *   - Debounce local changes; throttle watch pushes and page-entry syncs — 本地修改防抖; 观看记录推送和页面进入同步限频
 *   - Handle epoch resets, restores, full resyncs, retries, and lost sessions — 处理 epoch 重置, 旧副本恢复, 全量重同步, 重试和会话失效
 *   - Stay idle until start(); never touch the store after stop(), even when a request was in flight — start() 之前保持空闲; stop() 之后不再修改存储, 即使请求仍在进行
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
  resetForServerLoss,
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
  pull(params: SyncPullParams): Promise<SyncPullResponse>;
}

/**
 * SyncPullParams is one pull page request. `full` is set on every page of a pull chain that began
 * at revision 0 (a first sync or a full resync); the server then skips its tombstone-GC reset,
 * because such a chain already rebuilds the whole state.
 *
 * SyncPullParams 是一次分页拉取的请求参数. 从版本 0 开始的拉取链 (首次同步或全量重同步) 的每一页
 * 都设置 full; 服务端随后跳过墓碑清理触发的 reset, 因为这样的拉取链本来就会重建全部状态.
 */
export interface SyncPullParams {
  since: number;
  epoch: string;
  limit: number;
  full?: boolean;
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

// STOPPED aborts a cycle or flush whose engine was stopped (or stopped and started again) while a
// request was in flight.
//
// STOPPED 用于中止请求进行期间引擎已被停止 (或停止后又重新启动) 的同步流程或补写.
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
 * createSyncEngine builds an engine that stays idle until start(): it sends nothing and ignores
 * local changes. start() activates it (a no-op while active) and stop() returns it to idle. Work
 * begun before a stop() never writes the store, even when start() follows before it completes.
 *
 * createSyncEngine 创建的引擎在 start() 之前保持空闲: 不发送请求, 也不响应本地修改. start()
 * 启用引擎 (已启用时无操作), stop() 使其回到空闲. stop() 之前开始的工作不会再写入存储, 即使
 * 它完成前又调用了 start().
 *
 * A sync requested before the first start() waits for the first cycle after it (the launch sync),
 * so a caller mounted before the platform starts the engine still sees fresh data; stop() settles
 * it too. After a stop() the engine is idle again and requestSync resolves at once.
 *
 * 首次 start() 之前请求的同步会等待其后的第一轮同步 (启动同步), 因此在平台启动引擎之前挂载的
 * 调用方仍能看到最新数据; stop() 也会结束这种等待. stop() 之后引擎重新空闲, requestSync 立即
 * 返回.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { transport, store, classifyError } = options;
  const now = options.now ?? (() => Date.now());
  const runExclusive = options.runExclusive ?? ((task: () => Promise<void>) => task());
  let stopped = true;
  // generation counts start() and stop() calls; a cycle or flush captures it when it begins and
  // abandons its work once it changes, so a late response from an earlier lifetime is ignored.
  //
  // generation 统计 start() 和 stop() 的调用次数; 同步流程和补写开始时记录它, 一旦变化就放弃
  // 后续工作, 因此上一个生命周期的迟到响应会被忽略.
  let generation = 0;
  let running: Promise<void> | null = null;
  let flushing: Promise<void> | null = null;
  let flushingGeneration = 0;
  let flushAgain = false;
  let rerun = false;
  let lastCycleAt = Number.NEGATIVE_INFINITY;
  let lastPushAt = Number.NEGATIVE_INFINITY;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let pushDeadline = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = SYNC_RETRY_MIN_MS;
  let pushCount = 0;
  let unsubscribe: (() => void) | null = null;
  // startWaiters settle syncs requested before the first start(): the first cycle after start()
  // settles them, or stop() does. Callers such as the player gate bound their own wait. The first
  // start() or stop() ends the waiting phase, so an engine a platform decides never to start (an old
  // server) stops queueing waiters once it is stopped.
  //
  // startWaiters 用于结束首次 start() 之前请求的同步: start() 之后的第一轮同步结束它们, 或由
  // stop() 结束. 播放器等待逻辑等调用方自行限制等待时长. 首次 start() 或 stop() 结束等待阶段,
  // 因此平台决定不启动的引擎 (服务端过旧) 在被停止后不再累积等待者.
  let waitForStart = true;
  let startWaiters: Array<() => void> = [];

  function settleStartWaiters(): void {
    const waiters = startWaiters;
    startWaiters = [];
    for (const settle of waiters) settle();
  }

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

  function isStale(started: number): boolean {
    return stopped || started !== generation;
  }

  function checkStopped(started: number): void {
    if (isStale(started)) throw STOPPED;
  }

  function reportInvalid(invalid: PushInvalid[]): void {
    for (const { record, reason } of invalid) {
      console.warn("sync change rejected as invalid", record.kind, record.key, reason);
    }
  }

  function handleError(error: unknown, started: number): void {
    if (isStale(started)) return;
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
  async function pushPending(keepalive: boolean, started: number): Promise<boolean> {
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
        checkStopped(started);
        if (classifyError(error) === "conflict") return false;
        throw error;
      }
      checkStopped(started);
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
      pushCount += 1;
      reportInvalid(invalid);
      if (rejected.length > 0) options.onLimit?.(rejected);
      if (keepalive) return true;
    }
    return true;
  }

  // pullAll returns false after the server lost data this device has (a new epoch, or a same-epoch
  // reset whose rev is below the cursor: a restore from an older copy); the records are re-marked
  // and the cycle pushes them, unless they belong to another username (see resetForServerLoss).
  // Any other same-epoch reset is a full resync that may drop unseen records; a first pull from
  // cursor 0 must keep records this device just pushed.
  //
  // 服务端丢失本设备已有数据时 (新 epoch, 或同 epoch 且 rev 低于游标的 reset, 即从旧副本恢复),
  // pullAll 重新标记记录并返回 false, 由本轮流程推送; 记录属于其他用户名时则丢弃 (见
  // resetForServerLoss). 其他同 epoch 的 reset 是可以删除未出现记录的全量重同步; 从游标 0 开始的
  // 首次拉取必须保留本设备刚推送的记录.
  //
  // A full resync keeps its cursor in memory and saves it only together with finishFullResync. If a
  // later page fails, the saved cursor stays below min_rev, so the next cycle is reset again and
  // redoes the whole resync; records merged from earlier pages stay, because merging is idempotent.
  //
  // 全量重同步的游标只保存在内存中, 与 finishFullResync 一起写入. 如果后续某页失败, 已保存的
  // 游标仍低于 min_rev, 下一轮会再次收到 reset 并重做整个全量重同步; 之前页面合并的记录保留,
  // 因为合并是幂等的.
  async function pullAll(started: number): Promise<boolean> {
    let seen = new Set<string>();
    let full = false;
    let fullCursor = 0;
    let resets = 0;
    const fromZero = store.state().cursor === 0;
    for (;;) {
      const state = store.state();
      const since = full ? fullCursor : state.cursor;
      const sentAt = now();
      const params: SyncPullParams = { since, epoch: state.epoch, limit: SYNC_PULL_LIMIT };
      if (full || fromZero) params.full = true;
      const page = await transport.pull(params);
      checkStopped(started);
      store.clock.observe(page.server_time_ms, sentAt, now());
      if (page.reset) {
        if (state.epoch !== "" && page.epoch !== state.epoch) {
          store.update((current) => resetForServerLoss(current, page.epoch, store.username));
          return false;
        }
        if (page.rev < state.cursor) {
          store.update((current) => resetForServerLoss(current, current.epoch, store.username));
          return false;
        }
        resets += 1;
        if (resets > 1) throw new Error("sync pull asked for a reset twice");
        seen = new Set();
        full = true;
        fullCursor = 0;
        continue;
      }
      store.update((current) => {
        const next = applyPullPage(current, page, seen);
        return {
          ...next,
          cursor: full ? current.cursor : next.cursor,
          username: store.username,
          clockOffsetMs: store.clock.offsetMs(),
        };
      });
      if (full) fullCursor = page.rev;
      if (!page.has_more) break;
    }
    if (full) store.update((current) => ({ ...finishFullResync(current, seen), cursor: fullCursor }));
    return true;
  }

  async function cycle(): Promise<void> {
    // A cycle queued on the lock may start after stop().
    //
    // 在锁上排队的同步流程可能在 stop() 之后才开始.
    if (stopped) return;
    const started = generation;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    // Another writer (a browser tab) may have synced while this cycle waited for the lock.
    //
    // 本轮等待锁期间, 其他写入方 (浏览器的另一个标签页) 可能已经同步过.
    store.reload();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const pushed = await pushPending(false, started);
        const pulled = await pullAll(started);
        if (pushed && pulled) break;
      }
      lastCycleAt = now();
      retryDelay = SYNC_RETRY_MIN_MS;
    } catch (error) {
      handleError(error, started);
    }
  }

  function requestSync(reason: SyncReason): Promise<void> {
    if (stopped) {
      if (!waitForStart) return Promise.resolve();
      return new Promise((resolve) => startWaiters.push(resolve));
    }
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
    const waiters = startWaiters;
    startWaiters = [];
    running = loop().finally(() => {
      running = null;
      for (const settle of waiters) settle();
    });
    return running;
  }

  async function flush(keepalive: boolean): Promise<void> {
    const started = generation;
    const pushesBefore = pushCount;
    try {
      // A conflict means the server reset or was restored; only a full cycle can resolve it, and
      // the flush waits for it so a caller (logout, a source switch) knows the data left.
      //
      // 冲突说明服务端被重置或从旧副本恢复, 只有完整的一轮同步能处理; 补写会等待这一轮,
      // 让调用方 (退出登录, 切换来源) 知道数据已经发出.
      if (!(await pushPending(keepalive, started))) {
        await requestSync("retry");
        return;
      }
      // A push went through, so the server is reachable again: run the pending retry now instead
      // of waiting out its backoff. A flush with nothing to push proves nothing and leaves it.
      //
      // 推送成功说明服务端已恢复可达: 立即执行等待中的重试, 不再等待退避. 没有内容可推送的
      // 补写无法说明这一点, 保持重试不变.
      if (!keepalive && retryTimer !== null && pushCount !== pushesBefore) {
        clearTimeout(retryTimer);
        retryTimer = null;
        retryDelay = SYNC_RETRY_MIN_MS;
        void requestSync("retry");
      }
    } catch (error) {
      handleError(error, started);
    }
  }

  // flushNow is single-flight: a flush requested while one runs shares its result. A keepalive
  // flush always sends its own batch: the page is going away, and the running flush's request may
  // be cancelled with it.
  //
  // flushNow 同一时间只运行一次: 运行期间再次请求会共享当前结果. keepalive 补写总是发送自己的
  // 一批: 页面即将离开, 正在进行的补写请求可能随之被取消.
  //
  // A joined request may carry a record written after the running flush collected its last batch,
  // and it cancelled that record's push timer. The shared flush therefore pushes once more before
  // it settles. After a failure the pending retry pushes the record instead, so the backoff holds.
  //
  // 加入的请求可能带有正在进行的补写收集最后一批之后才写入的记录, 且它已取消该记录的推送
  // 定时器. 因此共享的补写在结束前会再推送一次. 失败后改由等待中的重试推送, 保持退避不变.
  function flushNow(flushOptions: { keepalive?: boolean } = {}): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pushTimer !== null) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    if (flushOptions.keepalive) return flush(true);
    // A flush from an earlier lifetime was abandoned; it cannot carry this request.
    //
    // 上一个生命周期的补写已被放弃, 不能代替本次请求.
    if (flushing && flushingGeneration === generation) {
      flushAgain = true;
      return flushing;
    }
    const started = generation;
    flushingGeneration = started;
    const loop = async () => {
      do {
        flushAgain = false;
        await flush(false);
      } while (flushAgain && !isStale(started) && retryTimer === null);
    };
    const current: Promise<void> = loop().finally(() => {
      if (flushing === current) flushing = null;
    });
    flushing = current;
    return current;
  }

  function start(): void {
    if (!stopped) return;
    stopped = false;
    waitForStart = false;
    generation += 1;
    retryDelay = SYNC_RETRY_MIN_MS;
    unsubscribe = store.onLocalChange(schedulePush);
  }

  function stop(): void {
    stopped = true;
    generation += 1;
    clearTimers();
    unsubscribe?.();
    unsubscribe = null;
    waitForStart = false;
    settleStartWaiters();
  }

  return { requestSync, flushNow, start, stop };
}
