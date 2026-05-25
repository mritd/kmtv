import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lazyWithReload } from "../lazyWithReload";

const RELOAD_FLAG = "kmtv.chunk-reload";

describe("lazyWithReload", () => {
  let reload: ReturnType<typeof vi.fn>;
  let originalReload: typeof window.location.reload;

  beforeEach(() => {
    window.sessionStorage.clear();
    reload = vi.fn();
    originalReload = window.location.reload;
    // location.reload is read-only on real browsers but happy-dom lets us swap it via defineProperty.
    // happy-dom
    // 允许通过 defineProperty 替换只读 reload.
    Object.defineProperty(window.location, "reload", { configurable: true, value: reload });
  });

  afterEach(() => {
    Object.defineProperty(window.location, "reload", { configurable: true, value: originalReload });
    window.sessionStorage.clear();
  });

  it("resolves the module unchanged on success and clears any prior reload flag", async () => {
    window.sessionStorage.setItem(RELOAD_FLAG, "1");
    const factory = vi.fn(async () => ({ default: () => null }));
    const Lazy = lazyWithReload(factory);
    // React.lazy lazily invokes the factory only when the component is rendered, but we can pry the promise out via the internal payload.
    // React.lazy
    // 仅在渲染时执行 factory, 这里通过内部 payload 拿到 promise.
    type LazyPayload = { _payload: { _result: unknown } };
    const payload = (Lazy as unknown as LazyPayload)._payload;
    await Promise.resolve();
    // Force evaluation by invoking the same path React would.
    // 通过 React 调用路径触发 evaluation.
    const ctor = (Lazy as unknown as { _init: (p: typeof payload) => unknown })._init;
    try {
      ctor(payload);
    } catch (suspense) {
      await (suspense as Promise<unknown>);
    }
    expect(factory).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOAD_FLAG)).toBeNull();
  });

  it("reloads the page and sets the flag when the chunk fetch fails", async () => {
    const factory = vi.fn(async () => {
      throw new Error("Failed to fetch dynamically imported module: http://x/HomePage-abcd.js");
    });
    const Lazy = lazyWithReload(factory);
    type LazyPayload = { _payload: { _result: unknown } };
    const payload = (Lazy as unknown as LazyPayload)._payload;
    const ctor = (Lazy as unknown as { _init: (p: typeof payload) => unknown })._init;
    try {
      ctor(payload);
    } catch (suspense) {
      // The lazy factory returns a never-resolving promise after triggering reload; race it against a microtask.
      // lazy factory
      // 触发 reload 后返回永不 resolve 的 promise, 微任务竞速即可.
      await Promise.race([suspense as Promise<unknown>, Promise.resolve()]);
    }
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOAD_FLAG)).not.toBeNull();
  });

  it("does not reload twice and rethrows when the flag is already set", async () => {
    window.sessionStorage.setItem(RELOAD_FLAG, "1");
    const factory = vi.fn(async () => {
      throw new Error("Failed to fetch dynamically imported module: http://x/HomePage-abcd.js");
    });
    const Lazy = lazyWithReload(factory);
    type LazyPayload = { _payload: { _result: unknown } };
    const payload = (Lazy as unknown as LazyPayload)._payload;
    const ctor = (Lazy as unknown as { _init: (p: typeof payload) => unknown })._init;
    let captured: unknown = null;
    try {
      ctor(payload);
    } catch (suspense) {
      try {
        await (suspense as Promise<unknown>);
      } catch (error) {
        captured = error;
      }
    }
    expect(reload).not.toHaveBeenCalled();
    expect(captured).toBeInstanceOf(Error);
  });

  it("passes through non-chunk errors without reloading", async () => {
    const factory = vi.fn(async () => {
      throw new TypeError("ordinary runtime bug");
    });
    const Lazy = lazyWithReload(factory);
    type LazyPayload = { _payload: { _result: unknown } };
    const payload = (Lazy as unknown as LazyPayload)._payload;
    const ctor = (Lazy as unknown as { _init: (p: typeof payload) => unknown })._init;
    let captured: unknown = null;
    try {
      ctor(payload);
    } catch (suspense) {
      try {
        await (suspense as Promise<unknown>);
      } catch (error) {
        captured = error;
      }
    }
    expect(reload).not.toHaveBeenCalled();
    expect((captured as Error).message).toBe("ordinary runtime bug");
  });

  it("treats errors with name=ChunkLoadError as chunk errors and reloads", async () => {
    // The ChunkLoadError name-based detection covers the Webpack runtime which sets
    // error.name rather than using a message pattern.
    // name=ChunkLoadError 的检测覆盖 Webpack 运行时, 后者通过 error.name 而非消息模式标识.
    const chunkError = Object.assign(new Error("chunk missing"), { name: "ChunkLoadError" });
    const factory = vi.fn(async () => {
      throw chunkError;
    });
    const Lazy = lazyWithReload(factory);
    type LazyPayload = { _payload: { _result: unknown } };
    const payload = (Lazy as unknown as LazyPayload)._payload;
    const ctor = (Lazy as unknown as { _init: (p: typeof payload) => unknown })._init;
    try {
      ctor(payload);
    } catch (suspense) {
      await Promise.race([suspense as Promise<unknown>, Promise.resolve()]);
    }
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOAD_FLAG)).not.toBeNull();
  });
});
