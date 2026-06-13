// English. 中文.
// Tests for the namespaced MMKV wrapper.
// MMKV 命名空间封装的测试.

import { _resetForTests, getNamespacedStorage, readJSON, writeJSON } from "./mmkv";

beforeEach(() => {
  _resetForTests();
});

describe("namespaced MMKV", () => {
  it("returns the same instance for the same serverURL", () => {
    const a = getNamespacedStorage("https://example.com");
    const b = getNamespacedStorage("https://example.com");
    expect(a).toBe(b);
  });

  it("returns different instances for different serverURLs", () => {
    const a = getNamespacedStorage("https://a.example");
    const b = getNamespacedStorage("https://b.example");
    expect(a).not.toBe(b);
  });

  it("round-trips JSON arrays", () => {
    const s = getNamespacedStorage("https://example.com");
    writeJSON(s, "favorites", [{ id: "1", title: "Hello" }]);
    expect(readJSON<{ id: string; title: string }[]>(s, "favorites", [])).toEqual([
      { id: "1", title: "Hello" },
    ]);
  });

  it("returns the fallback when the key is missing", () => {
    const s = getNamespacedStorage("https://fresh.example");
    expect(readJSON<number[]>(s, "missing", [42])).toEqual([42]);
  });

  it("returns the fallback when stored JSON is malformed", () => {
    const s = getNamespacedStorage("https://broken.example");
    s.set("bad", "{not json");
    expect(readJSON<number[]>(s, "bad", [1])).toEqual([1]);
  });

  it("preserves http vs https distinction in the namespace", () => {
    const httpStore = getNamespacedStorage("http://kmtv.example.com");
    const httpsStore = getNamespacedStorage("https://kmtv.example.com");
    expect(httpStore).not.toBe(httpsStore);
  });
});
