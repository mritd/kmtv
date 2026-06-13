// errorLog ring-buffer tests: append + read order + eviction + truncation.
// errorLog 环形缓冲测试: 追加 + 读取顺序 + 淘汰 + 截断.

import {
  MAX_ERROR_ENTRIES,
  appendErrorEntry,
  clearErrorLog,
  loadErrorEntries,
} from "./errorLog";

describe("errorLog ring buffer", () => {
  beforeEach(() => clearErrorLog());

  it("appends and reads back entries in newest-first order", () => {
    appendErrorEntry({ source: "global", message: "boom", stack: "trace", ts: 1 });
    appendErrorEntry({ source: "console", message: "noise", ts: 2 });
    const entries = loadErrorEntries();
    expect(entries[0]?.message).toBe("noise");
    expect(entries[1]?.message).toBe("boom");
  });

  it("evicts oldest beyond MAX_ERROR_ENTRIES", () => {
    for (let i = 0; i < MAX_ERROR_ENTRIES + 5; i++) {
      appendErrorEntry({ source: "console", message: `m${i}`, ts: i });
    }
    const entries = loadErrorEntries();
    expect(entries.length).toBe(MAX_ERROR_ENTRIES);
    expect(entries[0]?.message).toBe(`m${MAX_ERROR_ENTRIES + 4}`);
    expect(entries[entries.length - 1]?.message).toBe("m5");
  });

  it("clearErrorLog wipes the buffer", () => {
    appendErrorEntry({ source: "global", message: "x", ts: 1 });
    clearErrorLog();
    expect(loadErrorEntries()).toEqual([]);
  });

  it("truncates oversized message + stack to the hard caps", () => {
    const long = "a".repeat(2_000);
    appendErrorEntry({ source: "console", message: long, stack: long.repeat(3), ts: 1 });
    const [entry] = loadErrorEntries();
    expect(entry?.message.length).toBeLessThanOrEqual(500);
    expect((entry?.stack ?? "").length).toBeLessThanOrEqual(2000);
    // Trailing ellipsis is the visible truncation marker.
    expect(entry?.message.endsWith("…")).toBe(true);
    expect(entry?.stack?.endsWith("…")).toBe(true);
  });
});
