import { describe, expect, it, vi } from "vitest";

import { APIError, createAPIClient } from "./client";
import { createMemoryTokenStore } from "./tokenStore";

describe("APIClient", () => {
  it("sends bearer token and decodes JSON data", async () => {
    const store = createMemoryTokenStore();
    store.set({
      accessToken: "Base58Token",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });

    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ settings: { version: "v0.0.0-dev" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createAPIClient({ baseURL: "https://kmtv.example", tokenStore: store, fetcher });
    const result = await client.getSettings();

    expect(result.settings.version).toBe("v0.0.0-dev");
    expect(fetcher).toHaveBeenCalledWith("https://kmtv.example/api/v1/settings", expect.any(Object));
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer Base58Token");
  });

  it("stores login tokens and clears them on logout", async () => {
    const store = createMemoryTokenStore();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 1,
            username: "admin",
            role: "admin",
            access_token: "LoginToken",
            expires_at: "2026-05-23T12:00:00Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "logged out" }), { status: 200 }));

    const client = createAPIClient({ baseURL: "/", tokenStore: store, fetcher });

    await client.login("admin", "admin");
    expect(store.get()?.accessToken).toBe("LoginToken");

    await client.logout();
    expect(store.get()).toBeNull();
  });

  it("throws APIError with server error code and message", async () => {
    const client = createAPIClient({
      baseURL: "/",
      tokenStore: createMemoryTokenStore(),
      fetcher: async () =>
        new Response(JSON.stringify({ code: 1300, error: "internal server error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.search("slam dunk")).rejects.toMatchObject(
      new APIError(500, 1300, "internal server error"),
    );
  });

  it("builds search, detail, playback, and me requests", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, username: "admin", role: "admin" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "9", title: "Demo", episodes: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mode: "direct", url: "https://cdn.example/a.m3u8" }), { status: 200 }));

    const client = createAPIClient({ baseURL: "/", tokenStore: createMemoryTokenStore(), fetcher });

    await client.me();
    await client.search("灌篮高手", 2);
    await client.detail("source-a", "9");
    await client.playbackURL("https://cdn.example/a.m3u8", "source-a");

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/auth/me",
      "/api/v1/search?q=%E7%81%8C%E7%AF%AE%E9%AB%98%E6%89%8B&page=2",
      "/api/v1/detail?source=source-a&id=9",
      "/api/v1/playback/url",
    ]);
    expect(JSON.parse((fetcher.mock.calls[3][1] as RequestInit).body as string)).toEqual({
      url: "https://cdn.example/a.m3u8",
      source: "source-a",
    });
  });

  it("clears tokens on unauthorized responses", async () => {
    const store = createMemoryTokenStore({
      accessToken: "Expired",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    const client = createAPIClient({
      baseURL: "/",
      tokenStore: store,
      fetcher: async () =>
        new Response(JSON.stringify({ code: 1002, error: "not logged in" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(store.get()).toBeNull();
  });

  it("does NOT clear tokens when 401 came from a request without a token", async () => {
    const store = createMemoryTokenStore();
    expect(store.get()).toBeNull();
    const client = createAPIClient({
      baseURL: "/",
      tokenStore: store,
      fetcher: async () =>
        new Response(JSON.stringify({ code: 1002, error: "not logged in" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(store.get()).toBeNull();
    expect(store.lastClearReason()).toBeNull();
  });

  it("does NOT clear tokens when streaming search 401 came without a token", async () => {
    const store = createMemoryTokenStore();
    const client = createAPIClient({
      baseURL: "/",
      tokenStore: store,
      fetcher: async () => new Response(null, { status: 401, statusText: "Unauthorized" }),
    });

    await expect(client.searchStream("Movie", vi.fn())).rejects.toThrow("Unauthorized");
    expect(store.get()).toBeNull();
    expect(store.lastClearReason()).toBeNull();
  });

  it("does NOT clear a newer token when 401 came from a stale request carrying an old token", async () => {
    const store = createMemoryTokenStore({
      accessToken: "OldToken",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    // The fetcher simulates the user logging in (new token swap) before the
    // in-flight request's 401 response is processed.
    // fetcher 模拟在 401 响应回来前用户已经重新登录, 拿到了新 token.
    const client = createAPIClient({
      baseURL: "/",
      tokenStore: store,
      fetcher: async () => {
        store.set({
          accessToken: "NewToken",
          expiresAt: "2099-01-01T00:00:00Z",
          user: { id: 1, username: "admin", role: "admin" },
        });
        return new Response(JSON.stringify({ code: 1002, error: "not logged in" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(store.get()?.accessToken).toBe("NewToken");
    expect(store.lastClearReason()).toBeNull();
  });

  it("does NOT clear a newer token when streaming search 401 came from a stale token", async () => {
    const store = createMemoryTokenStore({
      accessToken: "OldToken",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    const client = createAPIClient({
      baseURL: "/",
      tokenStore: store,
      fetcher: async () => {
        store.set({
          accessToken: "NewToken",
          expiresAt: "2099-01-01T00:00:00Z",
          user: { id: 1, username: "admin", role: "admin" },
        });
        return new Response(null, { status: 401, statusText: "Unauthorized" });
      },
    });

    await expect(client.searchStream("Movie", vi.fn())).rejects.toThrow("Unauthorized");
    expect(store.get()?.accessToken).toBe("NewToken");
    expect(store.lastClearReason()).toBeNull();
  });

  it("clears tokens on unauthorized streaming search responses", async () => {
    const store = createMemoryTokenStore({
      accessToken: "Expired",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    const client = createAPIClient({
      baseURL: "/",
      tokenStore: store,
      fetcher: async () => new Response(null, { status: 401, statusText: "Unauthorized" }),
    });

    await expect(client.searchStream("Movie", vi.fn())).rejects.toThrow("Unauthorized");
    expect(store.get()).toBeNull();
  });

  it("builds account profile, password, and avatar requests", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, username: "new-admin", role: "admin" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "password updated" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 1, username: "new-admin", role: "admin", avatar: "/api/v1/avatar/new-admin" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, username: "new-admin", role: "admin" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = createAPIClient({ baseURL: "/", tokenStore: createMemoryTokenStore(), fetcher });

    await client.updateProfile("new-admin");
    await client.changePassword("old-password", "new-password");
    await client.uploadAvatar(new File(["avatar"], "avatar.png", { type: "image/png" }));
    await client.deleteAvatar();

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/auth/profile",
      "/api/v1/auth/password",
      "/api/v1/auth/avatar",
      "/api/v1/auth/avatar",
    ]);
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({ username: "new-admin" });
    expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      old_password: "old-password",
      new_password: "new-password",
    });
    expect((fetcher.mock.calls[2][1] as RequestInit).body).toBeInstanceOf(FormData);
    expect((fetcher.mock.calls[3][1] as RequestInit).method).toBe("DELETE");
  });

  it("builds admin source, subscription, user, and settings requests", async () => {
    const ok = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const created = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 201, headers: { "content-type": "application/json" } });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok({ sources: [] }))
      .mockResolvedValueOnce(
        created({
          id: 1,
          key: "source-a",
          name: "Source A",
          api: "https://a.example",
          detail: "",
          enabled: true,
          searchable: true,
          comment: "",
          health: "unknown",
          last_check: "",
          created_at: "",
          updated_at: "",
        }),
      )
      .mockResolvedValueOnce(ok({ message: "source updated" }))
      .mockResolvedValueOnce(ok({ message: "sources updated", count: 2 }))
      .mockResolvedValueOnce(ok({ health: "healthy" }))
      .mockResolvedValueOnce(ok({ message: "source deleted" }))
      .mockResolvedValueOnce(ok({ subscriptions: [] }))
      .mockResolvedValueOnce(
        created({ id: 2, url: "https://config.example", auto_update: true, interval: 3600, last_sync: "", updated_at: "" }),
      )
      .mockResolvedValueOnce(ok({ message: "subscription synced" }))
      .mockResolvedValueOnce(ok({ users: [] }))
      .mockResolvedValueOnce(created({ id: 3, username: "user", role: "user" }))
      .mockResolvedValueOnce(ok({ message: "settings updated" }));
    const client = createAPIClient({ baseURL: "/", tokenStore: createMemoryTokenStore(), fetcher });

    await client.listSources();
    await client.createSource({
      key: "source-a",
      name: "Source A",
      api: "https://a.example",
      detail: "",
      enabled: true,
      searchable: true,
      comment: "",
    });
    await client.updateSource(1, {
      key: "source-a",
      name: "Source A",
      api: "https://a.example",
      detail: "",
      enabled: true,
      searchable: true,
      comment: "",
    });
    await client.bulkSetSourcesEnabled([1, 2], true);
    await client.checkSource(1);
    await client.deleteSource(1);
    await client.listSubscriptions();
    await client.createSubscription({ url: "https://config.example", auto_update: true, interval: 3600 });
    await client.syncSubscription(2);
    await client.listUsers();
    await client.createUser({ username: "user", password: "password", role: "user" });
    await client.updateSettings({ site_name: "KMTV" });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/admin/sources",
      "/api/v1/admin/sources",
      "/api/v1/admin/sources/1",
      "/api/v1/admin/sources/bulk-enabled",
      "/api/v1/admin/sources/1/check",
      "/api/v1/admin/sources/1",
      "/api/v1/admin/subscriptions",
      "/api/v1/admin/subscriptions",
      "/api/v1/admin/subscriptions/2/sync",
      "/api/v1/admin/users",
      "/api/v1/admin/users",
      "/api/v1/admin/settings",
    ]);
  });
});
