// sync/activeSyncEngine.ts — the engine of the open sync scope, so logout can stop it first.
//
// sync/activeSyncEngine.ts — 当前同步作用域的引擎, 让退出登录能先停止它.

import type { SyncEngine } from "./syncEngine";

let active: Pick<SyncEngine, "stop"> | null = null;

/**
 * setActiveSyncEngine registers the engine SyncProvider just started.
 *
 * setActiveSyncEngine 登记 SyncProvider 刚启动的引擎.
 */
export function setActiveSyncEngine(engine: Pick<SyncEngine, "stop">): void {
  active = engine;
}

/**
 * clearActiveSyncEngine drops the registration if it still points at this engine.
 *
 * clearActiveSyncEngine 在登记仍指向该引擎时清除登记.
 */
export function clearActiveSyncEngine(engine: Pick<SyncEngine, "stop">): void {
  if (active === engine) active = null;
}

/**
 * stopActiveSyncEngine stops the registered engine, so no sync request runs while logout waits for
 * the server.
 *
 * stopActiveSyncEngine 停止已登记的引擎, 使退出登录等待服务端期间不再发出同步请求.
 */
export function stopActiveSyncEngine(): void {
  active?.stop();
  active = null;
}
