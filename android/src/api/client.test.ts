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

  it("getBlob returns the response body as an ArrayBuffer with bearer injected", async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const fetcher = jest.fn(async (_req: Request) =>
      new Response(buf, { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    const client = createAPIClient({
      baseURL: "http://localhost",
      getToken: () => "tk",
      onUnauthorized: () => {},
      fetcher: fetcher as unknown as typeof fetch,
    });
    const out = await client.getBlob("/avatar/alice");
    expect(out.byteLength).toBe(3);
    const req = (fetcher as unknown as jest.Mock).mock.calls[0][0] as Request;
    expect(req.headers.get("Authorization")).toBe("Bearer tk");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("http://localhost/api/v1/avatar/alice");
  });

  it("getBlob surfaces 401 via onUnauthorized", async () => {
    const fetcher = jest.fn(async () => new Response("nope", { status: 401 }));
    const onUnauth = jest.fn();
    const client = createAPIClient({
      baseURL: "http://localhost",
      getToken: () => "tk",
      onUnauthorized: onUnauth,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.getBlob("/avatar/alice")).rejects.toMatchObject({ kind: "unauthorized" });
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it("putMultipart sends FormData with Authorization and lets fetch auto-set the multipart boundary", async () => {
    let captured: Request | null = null;
    const fetcher = jest.fn(async (req: Request) => {
      captured = req;
      return new Response(JSON.stringify({ id: 1, username: "u", role: "user" }), { status: 200 });
    });
    const client = createAPIClient({
      baseURL: "http://localhost",
      getToken: () => "tk",
      onUnauthorized: () => {},
      fetcher: fetcher as unknown as typeof fetch,
    });
    const form = new FormData();
    form.append("avatar", { uri: "file:///x.jpg", name: "a.jpg", type: "image/jpeg" } as unknown as Blob);
    const out = await client.putMultipart<{ id: number }>("/auth/avatar", form);
    expect(out.id).toBe(1);
    expect(captured!.method).toBe("PUT");
    expect(captured!.headers.get("Authorization")).toBe("Bearer tk");
    // Fetch must auto-attach a multipart/form-data Content-Type WITH a boundary token. We never
    // set it ourselves — verifying the boundary segment exists is the real signal.
    // 由 fetch 自动追加带 boundary 的 multipart/form-data Content-Type; 我们不手动设置, 校验
    // boundary 段存在即代表流程正确.
    const contentType = captured!.headers.get("Content-Type");
    expect(contentType).toMatch(/^multipart\/form-data;\s*boundary=/);
  });

  it("delReturning parses the JSON response body", async () => {
    const fetcher = jest.fn(async () =>
      new Response(JSON.stringify({ id: 9, username: "u", role: "user" }), { status: 200 }),
    );
    const client = createAPIClient({
      baseURL: "http://localhost",
      getToken: () => "",
      onUnauthorized: () => {},
      fetcher: fetcher as unknown as typeof fetch,
    });
    const out = await client.delReturning<{ id: number }>("/auth/avatar");
    expect(out.id).toBe(9);
  });

  it("delReturning forwards bearer and uses DELETE method", async () => {
    let captured: Request | null = null;
    const fetcher = jest.fn(async (req: Request) => {
      captured = req;
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const client = createAPIClient({
      baseURL: "http://localhost",
      getToken: () => "tk",
      onUnauthorized: () => {},
      fetcher: fetcher as unknown as typeof fetch,
    });
    await client.delReturning<unknown>("/auth/avatar");
    expect(captured!.method).toBe("DELETE");
    expect(captured!.headers.get("Authorization")).toBe("Bearer tk");
  });
});
