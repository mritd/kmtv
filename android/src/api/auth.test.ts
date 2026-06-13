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
    getBlob: jest.fn(async () => new ArrayBuffer(0)),
    putMultipart: jest.fn(async () => ({}) as unknown),
    delReturning: jest.fn(async () => ({}) as unknown),
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

  it("updateProfile puts to /auth/profile with { username }", async () => {
    const put = jest.fn(async () => ({ id: 1, username: "u2", role: "user" }));
    const auth = createAuthAPI(mockClient({ put: put as unknown as APIClient["put"] }));
    const r = await auth.updateProfile("u2");
    expect(put).toHaveBeenCalledWith("/auth/profile", { username: "u2" });
    expect(r.username).toBe("u2");
  });

  it("changePassword puts to /auth/password with snake_case body", async () => {
    const put = jest.fn(async () => ({ message: "ok" }));
    const auth = createAuthAPI(mockClient({ put: put as unknown as APIClient["put"] }));
    await auth.changePassword("old", "new");
    expect(put).toHaveBeenCalledWith("/auth/password", { old_password: "old", new_password: "new" });
  });

  it("uploadAvatar puts multipart with an 'avatar' part carrying {uri, name, type}", async () => {
    let captured: FormData | null = null;
    const putMultipart = jest.fn(async (path: string, form: FormData) => {
      expect(path).toBe("/auth/avatar");
      captured = form;
      return { id: 1, username: "u", role: "user", avatar: "/api/v1/avatar/u" };
    });
    const auth = createAuthAPI(mockClient({ putMultipart: putMultipart as unknown as APIClient["putMultipart"] }));
    const r = await auth.uploadAvatar("file:///x.jpg", "image/jpeg");
    expect(r.avatar).toBe("/api/v1/avatar/u");
    // RN's FormData has no forEach() / entries(). Both real RN and jsdom polyfill expose
    // getParts() returning the staged parts. Assert the avatar part shape.
    // RN 的 FormData 没有 forEach() / entries(), 真机与 jsdom polyfill 都暴露 getParts().
    const parts = (captured as unknown as { getParts?: () => Array<{ fieldName: string; uri?: string; type?: string }> }).getParts?.();
    if (parts) {
      const avatarPart = parts.find((p) => p.fieldName === "avatar");
      expect(avatarPart).toBeDefined();
      expect(avatarPart!.uri).toBe("file:///x.jpg");
      expect(avatarPart!.type).toBe("image/jpeg");
    } else {
      // jsdom / undici implements the Web FormData with .get() / .getAll().
      const entry = (captured as unknown as FormData).get("avatar");
      expect(entry).toBeTruthy();
    }
  });

  it("deleteAvatar DELETEs /auth/avatar and returns refreshed User", async () => {
    const delReturning = jest.fn(async (path: string) => {
      expect(path).toBe("/auth/avatar");
      return { id: 1, username: "u", role: "user" };
    });
    const auth = createAuthAPI(mockClient({ delReturning: delReturning as unknown as APIClient["delReturning"] }));
    const r = await auth.deleteAvatar();
    expect(r.avatar).toBeUndefined();
  });
});
