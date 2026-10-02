// activeSyncEngine tests — registration, clearing, and stopping of the open scope's engine.
//
// activeSyncEngine 测试 — 当前作用域引擎的登记, 清除和停止.

import {
  clearActiveSyncEngine,
  isActiveSyncEngine,
  setActiveSyncEngine,
  stopActiveSyncEngine,
} from "./activeSyncEngine";

function fakeEngine() {
  return { stop: jest.fn() };
}

afterEach(() => {
  stopActiveSyncEngine();
});

describe("activeSyncEngine", () => {
  it("reports the registered engine as active", () => {
    const engine = fakeEngine();
    expect(isActiveSyncEngine(engine)).toBe(false);
    setActiveSyncEngine(engine);
    expect(isActiveSyncEngine(engine)).toBe(true);
    expect(isActiveSyncEngine(fakeEngine())).toBe(false);
  });

  it("keeps the current registration when another engine is cleared", () => {
    const current = fakeEngine();
    setActiveSyncEngine(current);
    clearActiveSyncEngine(fakeEngine());
    expect(isActiveSyncEngine(current)).toBe(true);
    clearActiveSyncEngine(current);
    expect(isActiveSyncEngine(current)).toBe(false);
  });

  it("stops and unregisters the engine", () => {
    const engine = fakeEngine();
    setActiveSyncEngine(engine);
    stopActiveSyncEngine();
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(isActiveSyncEngine(engine)).toBe(false);
  });
});
