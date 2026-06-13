// searchHistory tests cover add (dedup + cap), recent, clearAll, server scope.
// searchHistory 测试覆盖 upsert(去重+上限)、列出、清空、按服务器隔离.

import { _resetForTests } from "./mmkv";
import { addSearchHistory, clearSearchHistory, loadSearchHistory } from "./searchHistory";

const A = "https://a.test";
const B = "https://b.test";

beforeEach(() => _resetForTests());

describe("searchHistory", () => {
  it("loadSearchHistory returns [] on empty storage", () => {
    expect(loadSearchHistory(A)).toEqual([]);
  });

  it("addSearchHistory inserts a new entry at the front", () => {
    addSearchHistory(A, "foo");
    addSearchHistory(A, "bar");
    expect(loadSearchHistory(A).map((i) => i.query)).toEqual(["bar", "foo"]);
  });

  it("addSearchHistory trims whitespace and ignores empty input", () => {
    addSearchHistory(A, "   ");
    addSearchHistory(A, "  foo  ");
    expect(loadSearchHistory(A).map((i) => i.query)).toEqual(["foo"]);
  });

  it("addSearchHistory dedups by query, moving existing match to the front", () => {
    addSearchHistory(A, "foo");
    addSearchHistory(A, "bar");
    addSearchHistory(A, "foo");
    const queries = loadSearchHistory(A).map((i) => i.query);
    expect(queries).toEqual(["foo", "bar"]);
  });

  it("addSearchHistory caps the history at 20 entries", () => {
    for (let i = 0; i < 25; i++) addSearchHistory(A, `q${i}`);
    const all = loadSearchHistory(A);
    expect(all).toHaveLength(20);
    expect(all[0]!.query).toBe("q24");
    expect(all[19]!.query).toBe("q5");
  });

  it("clearSearchHistory wipes the current server only", () => {
    addSearchHistory(A, "foo");
    addSearchHistory(B, "baz");
    clearSearchHistory(A);
    expect(loadSearchHistory(A)).toEqual([]);
    expect(loadSearchHistory(B).map((i) => i.query)).toEqual(["baz"]);
  });

  it("isolates entries between servers", () => {
    addSearchHistory(A, "one");
    addSearchHistory(B, "two");
    expect(loadSearchHistory(A).map((i) => i.query)).toEqual(["one"]);
    expect(loadSearchHistory(B).map((i) => i.query)).toEqual(["two"]);
  });
});
