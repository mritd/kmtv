// Tests for the SecureStore wrapper used by the auth store.
// authStore 使用的 SecureStore 封装的测试.

import { Platform } from "react-native";

import { clearToken, loadToken, saveToken } from "./secureStore";

describe("secureStore token helpers", () => {
  it("returns null before any token is saved", async () => {
    await clearToken();
    expect(await loadToken()).toBeNull();
  });

  it("round-trips a token value", async () => {
    await saveToken("abc-123");
    expect(await loadToken()).toBe("abc-123");
  });

  it("clears a previously saved token", async () => {
    await saveToken("xyz");
    await clearToken();
    expect(await loadToken()).toBeNull();
  });
});

describe("secureStore token helpers (non-native fallback)", () => {
  const realOS = Platform.OS;
  const fakeStore: Record<string, string> = {};
  const fakeStorage = {
    getItem: (k: string) => (k in fakeStore ? fakeStore[k]! : null),
    setItem: (k: string, v: string) => { fakeStore[k] = v; },
    removeItem: (k: string) => { delete fakeStore[k]; },
    clear: () => { for (const k of Object.keys(fakeStore)) delete fakeStore[k]; },
    key: (i: number) => Object.keys(fakeStore)[i] ?? null,
    get length() { return Object.keys(fakeStore).length; },
  };
  const realLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

  afterAll(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: realOS });
    if (realLocalStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: realLocalStorage });
    }
  });
  beforeEach(() => { fakeStorage.clear(); });

  it("uses localStorage on web instead of expo-secure-store so the app can run in a browser", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fakeStorage });

    await saveToken("web-token-1");
    expect(await loadToken()).toBe("web-token-1");
    expect(fakeStorage.getItem("kmtv.bearer.token")).toBe("web-token-1");
    await clearToken();
    expect(await loadToken()).toBeNull();
    expect(fakeStorage.getItem("kmtv.bearer.token")).toBeNull();
  });

  it("treats every non-android/ios OS as non-native (e.g. expo-windows / macos)", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "windows" });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fakeStorage });

    await saveToken("win-token");
    expect(await loadToken()).toBe("win-token");
    expect(fakeStorage.getItem("kmtv.bearer.token")).toBe("win-token");
  });

  it("falls back to in-memory storage when localStorage is missing so SSR / Node cannot crash", async () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
    // Force localStorage absent — same shape as SSR / a node testbed where the host
    // never injected a DOM. The implementation must not fall through to expo-secure-store.
    // 强制 localStorage 不存在, 对应 SSR / 未注入 DOM 的 Node 测试环境.
    // 实现不得回落到 expo-secure-store, 否则 native module 缺失会再次崩溃.
    delete (globalThis as { localStorage?: Storage }).localStorage;
    await saveToken("memory-token");
    expect(await loadToken()).toBe("memory-token");
    await clearToken();
    expect(await loadToken()).toBeNull();
  });
});
