// English. 中文.
// API client tests cover URL construction, bearer injection, 401 dispatch, and timeout.
// API client 测试覆盖 URL 构造、bearer 注入、401 派发与超时.

import { createAPIClient } from "./client";

describe("createAPIClient", () => {
  it("prefixes /api/v1 onto every request path", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = createAPIClient({
      baseURL: "https://k.example.com",
      getToken: () => null,
      onUnauthorized: () => {},
      fetcher,
    });
    await client.get<{ ok: boolean }>("/settings");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const req = (fetcher as unknown as jest.Mock).mock.calls[0][0] as Request;
    expect(req.url).toBe("https://k.example.com/api/v1/settings");
  });

  it("injects Authorization header when a token is available", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const client = createAPIClient({
      baseURL: "https://k.example.com",
      getToken: () => "tok-abc",
      onUnauthorized: () => {},
      fetcher,
    });
    await client.get("/auth/me");
    const req = (fetcher as unknown as jest.Mock).mock.calls[0][0] as Request;
    expect(req.headers.get("Authorization")).toBe("Bearer tok-abc");
  });

  it("omits Authorization when token provider returns null", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const client = createAPIClient({
      baseURL: "https://k.example.com",
      getToken: () => null,
      onUnauthorized: () => {},
      fetcher,
    });
    await client.get("/auth/me");
    const req = (fetcher as unknown as jest.Mock).mock.calls[0][0] as Request;
    expect(req.headers.get("Authorization")).toBeNull();
  });

  it("invokes onUnauthorized and rejects with kind=unauthorized on 401", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ error: "x" }), { status: 401 }));
    const onUnauthorized = jest.fn();
    const client = createAPIClient({
      baseURL: "https://k.example.com",
      getToken: () => "t",
      onUnauthorized,
      fetcher,
    });
    await expect(client.get("/auth/me")).rejects.toEqual({ kind: "unauthorized" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("rejects with kind=server on non-2xx", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    const client = createAPIClient({
      baseURL: "https://k.example.com",
      getToken: () => null,
      onUnauthorized: () => {},
      fetcher,
    });
    await expect(client.get("/x")).rejects.toEqual({ kind: "server", message: "boom" });
  });

  it("rejects with kind=timeout when fetcher throws AbortError", async () => {
    const fetcher = jest.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const client = createAPIClient({
      baseURL: "https://k.example.com",
      getToken: () => null,
      onUnauthorized: () => {},
      fetcher,
    });
    await expect(client.get("/x", { timeoutMs: 100 })).rejects.toEqual({ kind: "timeout" });
  });

  it("rejects with kind=network when fetcher throws a non-abort error", async () => {
    const fetcher = jest.fn(async () => { throw new Error("ECONNRESET"); });
    const client = createAPIClient({
      baseURL: "https://k.example.com",
      getToken: () => null,
      onUnauthorized: () => {},
      fetcher,
    });
    await expect(client.get("/x")).rejects.toEqual({ kind: "network" });
  });

  it("strips trailing slash from baseURL", async () => {
    const fetcher = jest.fn(async () => new Response("{}", { status: 200 }));
    const client = createAPIClient({
      baseURL: "https://k.example.com/",
      getToken: () => null,
      onUnauthorized: () => {},
      fetcher,
    });
    await client.get("/settings");
    expect(((fetcher as unknown as jest.Mock).mock.calls[0][0] as Request).url).toBe("https://k.example.com/api/v1/settings");
  });

  it("post sends JSON body and Content-Type header", async () => {
    const fetcher = jest.fn(async () => new Response("{}", { status: 200 }));
    const client = createAPIClient({
      baseURL: "https://k.example.com",
      getToken: () => null,
      onUnauthorized: () => {},
      fetcher,
    });
    await client.post("/auth/login", { username: "u", password: "p" });
    const req = (fetcher as unknown as jest.Mock).mock.calls[0][0] as Request;
    expect(req.method).toBe("POST");
    expect(req.headers.get("Content-Type")).toBe("application/json");
    const body = await req.text();
    expect(JSON.parse(body)).toEqual({ username: "u", password: "p" });
  });
});
