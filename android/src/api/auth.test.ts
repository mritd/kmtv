// Auth API tests verify the three M1 endpoints (login, logout, me).
// Auth API 测试覆盖 M1 三个端点 (login, logout, me).

import { createAuthAPI } from "./auth";
import type { APIClient } from "./client";

function mockClient(overrides: Partial<APIClient> = {}): APIClient {
  return {
    baseURL: "https://x",
    get: jest.fn(async () => ({}) as unknown),
    post: jest.fn(async () => ({}) as unknown),
    put: jest.fn(async () => ({}) as unknown),
    del: jest.fn(async () => undefined),
    ...overrides,
  } as APIClient;
}

describe("AuthAPI", () => {
  it("login posts to /auth/login", async () => {
    const post = jest.fn(async () => ({
      id: 1,
      username: "u",
      role: "user",
      access_token: "t",
      expires_at: "2030-01-01",
    }));
    const auth = createAuthAPI(mockClient({ post: post as unknown as APIClient["post"] }));
    const r = await auth.login("u", "p");
    expect(post).toHaveBeenCalledWith("/auth/login", { username: "u", password: "p" });
    expect(r.access_token).toBe("t");
    expect(r.username).toBe("u");
  });

  it("logout posts to /auth/logout and swallows server errors", async () => {
    const post = jest.fn(async () => { throw { kind: "server", message: "down" }; });
    const auth = createAuthAPI(mockClient({ post: post as unknown as APIClient["post"] }));
    await expect(auth.logout()).resolves.toBeUndefined();
  });

  it("me gets /auth/me", async () => {
    const get = jest.fn(async () => ({ id: 1, username: "u", role: "user" }));
    const auth = createAuthAPI(mockClient({ get: get as unknown as APIClient["get"] }));
    const r = await auth.me();
    expect(get).toHaveBeenCalledWith("/auth/me");
    expect(r.username).toBe("u");
  });
});
