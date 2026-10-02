// sync/activeSyncEngine.ts — the engine of the open sync scope, so logout can stop it first.
//
// sync/activeSyncEngine.ts — 当前同步作用域的引擎, 让退出登录能先停止它.

import type { SyncEngine } from "./syncEngine";

let active: Pick<SyncEngine, "stop"> | null = null;

/**
 * setActiveSyncEngine registers the engine of the scope SyncProvider just opened, before its server
 * check, so logout can stop it at any point.
 *
 * setActiveSyncEngine 在服务器检查之前登记 SyncProvider 刚打开的作用域的引擎, 让退出登录随时都能
 * 停止它.
 */
export function setActiveSyncEngine(engine: Pick<SyncEngine, "stop">): void {
  active = engine;
}

/**
 * isActiveSyncEngine reports whether this engine is still registered; logout or a closed scope
 * clears the registration, and the engine must then not start.
 *
 * isActiveSyncEngine 判断该引擎是否仍被登记; 退出登录或作用域关闭会清除登记, 此后引擎不能启动.
 */
export function isActiveSyncEngine(engine: Pick<SyncEngine, "stop">): boolean {
  return active === engine;
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
