// Search API tests: sync /search GET + react-native-sse driven stream.
// 搜索 API 测试: 同步 /search GET + 由 react-native-sse 驱动的流.

import type { APIClient } from "./client";
import type { SearchResponse } from "./types";

import { createSearchAPI } from "./search";

function mockClient(get: jest.Mock): APIClient {
  return {
    baseURL: "https://api.test",
    get: get as unknown as APIClient["get"],
    post: jest.fn() as unknown as APIClient["post"],
    put: jest.fn() as unknown as APIClient["put"],
    del: jest.fn() as unknown as APIClient["del"],
    getBlob: jest.fn() as unknown as APIClient["getBlob"],
    putMultipart: jest.fn() as unknown as APIClient["putMultipart"],
    delReturning: jest.fn() as unknown as APIClient["delReturning"],
  };
}

interface MockEventSourceLike {
  url: string;
  options: { headers?: Record<string, string> };
  closed: boolean;
  dispatch(type: string, data: unknown): void;
  triggerError(message?: string): void;
  triggerClose(): void;
}

function lastMockEventSource(): MockEventSourceLike {
  const handle = (globalThis as { __lastMockEventSource?: MockEventSourceLike }).__lastMockEventSource;
  if (!handle) throw new Error("EventSource not constructed");
  return handle;
}

describe("createSearchAPI.search", () => {
  it("GETs /search?q=… and trims the query", async () => {
    const payload: SearchResponse = { results: [] };
    const get = jest.fn(async () => payload);
    const api = createSearchAPI(mockClient(get), () => null);
    await expect(api.search("  hello world  ")).resolves.toEqual(payload);
    expect(get).toHaveBeenCalledTimes(1);
    const path = (get.mock.calls[0] as unknown as [string])[0];
    expect(path.startsWith("/search?")).toBe(true);
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(params.get("q")).toBe("hello world");
    expect(params.get("page")).toBeNull();
  });

  it("forwards the page parameter when provided", async () => {
    const get = jest.fn(async () => ({ results: [] }));
    const api = createSearchAPI(mockClient(get), () => null);
    await api.search("k", 3);
    const path = (get.mock.calls[0] as unknown as [string])[0];
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(params.get("page")).toBe("3");
  });
});

describe("createSearchAPI.searchStream", () => {
  it("opens an EventSource at /api/v1/search/stream with Bearer header when token present", async () => {
    const get = jest.fn();
    const api = createSearchAPI(mockClient(get), () => "t-123");
    const onProgress = jest.fn();
    const promise = api.searchStream("hi", onProgress);
    const src = lastMockEventSource();
    expect(src.url).toBe("https://api.test/api/v1/search/stream?q=hi");
    expect(src.options.headers?.Authorization).toBe("Bearer t-123");
    const wireResult = { title: "T", type: "", year: "", cover: "", desc: "", sources: [] };
    src.dispatch("result", { results: [wireResult] });
    await expect(promise).resolves.toEqual({ results: [wireResult] });
    expect(src.closed).toBe(true);
  });

  it("does not set Authorization when token is null", async () => {
    const api = createSearchAPI(mockClient(jest.fn()), () => null);
    const promise = api.searchStream("x", jest.fn());
    const src = lastMockEventSource();
    expect(src.options.headers?.Authorization).toBeUndefined();
    src.dispatch("result", { results: [] });
    await promise;
  });

  it("forwards progress events to onProgress", async () => {
    const api = createSearchAPI(mockClient(jest.fn()), () => null);
    const onProgress = jest.fn();
    const promise = api.searchStream("x", onProgress);
    const src = lastMockEventSource();
    src.dispatch("progress", { phase: "searching", completed: 2, total: 5 });
    src.dispatch("progress", { phase: "probing", completed: 1, total: 3 });
    src.dispatch("result", { results: [] });
    await promise;
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { phase: "searching", completed: 2, total: 5 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { phase: "probing", completed: 1, total: 3 });
  });

  it("rejects with the SSE error message on server-side error event", async () => {
    const api = createSearchAPI(mockClient(jest.fn()), () => null);
    const promise = api.searchStream("x", jest.fn());
    const src = lastMockEventSource();
    src.dispatch("error", { message: "upstream down" });
    await expect(promise).rejects.toThrow("upstream down");
    expect(src.closed).toBe(true);
  });

  it("rejects when the transport itself errors (no JSON payload)", async () => {
    const api = createSearchAPI(mockClient(jest.fn()), () => null);
    const promise = api.searchStream("x", jest.fn());
    const src = lastMockEventSource();
    src.triggerError("network lost");
    await expect(promise).rejects.toThrow("network lost");
    expect(src.closed).toBe(true);
  });

  it("aborts on signal: closes the source and rejects with AbortError", async () => {
    const api = createSearchAPI(mockClient(jest.fn()), () => null);
    const controller = new AbortController();
    const promise = api.searchStream("x", jest.fn(), { signal: controller.signal });
    const src = lastMockEventSource();
    controller.abort();
    expect(src.closed).toBe(true);
    await expect(promise).rejects.toThrow(/abort/i);
  });
});
