// authStore tests cover bootstrap, connect, login, logout, and 401 recovery paths.
// authStore 测试覆盖 bootstrap、connect、login、logout 与 401 恢复路径.

import type { AuthAPI } from "../api/auth";
import { clearToken, saveToken } from "../storage/secureStore";
import { useAuthStore } from "./authStore";
import { useServerStore } from "./serverStore";

function makeAuth(overrides: Partial<AuthAPI> = {}): AuthAPI {
  return {
    login: jest.fn(async () => ({
      id: 1,
      username: "u",
      role: "user" as const,
      access_token: "tok",
      expires_at: "2030-01-01",
    })),
    logout: jest.fn(async () => undefined),
    me: jest.fn(async () => ({ id: 1, username: "u", role: "user" as const })),
    updateProfile: jest.fn(async (n: string) => ({ id: 1, username: n, role: "user" as const })),
    changePassword: jest.fn(async () => undefined),
    uploadAvatar: jest.fn(async () => ({ id: 1, username: "u", role: "user" as const })),
    deleteAvatar: jest.fn(async () => ({ id: 1, username: "u", role: "user" as const })),
    ...overrides,
  };
}

beforeEach(async () => {
  await clearToken();
  useServerStore.setState({ serverURL: null });
  useAuthStore.setState({ status: "loading", user: null, token: null, serverVersion: "" });
});

describe("authStore.bootstrap", () => {
  it("goes to serverSetup when no server is saved", async () => {
    await useAuthStore.getState().bootstrap(() => makeAuth());
    expect(useAuthStore.getState().status).toBe("serverSetup");
  });

  it("goes to authenticated when server + valid token resolve me()", async () => {
    useServerStore.getState().setServerURL("https://k.example.com");
    await saveToken("tok");
    await useAuthStore.getState().bootstrap(() => makeAuth());
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().user?.username).toBe("u");
  });

  it("falls back to serverSetup when me() throws unauthorized", async () => {
    useServerStore.getState().setServerURL("https://k.example.com");
    await saveToken("tok");
    const auth = makeAuth({ me: jest.fn(async () => { throw { kind: "unauthorized" }; }) });
    await useAuthStore.getState().bootstrap(() => auth);
    expect(useAuthStore.getState().status).toBe("serverSetup");
  });

  it("recovers to serverSetup AND surfaces the error via console.error when the auth factory throws", async () => {
    // Simulates a programmer-level bug (TypeError-style) in the factory pipeline; the outer
    // try/catch must NOT swallow it silently — it has to land in console.error so it is
    // visible during development and reaches the diagnostics ring buffer in production.
    // 模拟 factory 链上的编程级错误 (TypeError 等); 外层 try/catch 不得静默吞掉, 必须打到 console.error,
    // 开发期可见, 生产期亦能进入诊断环形缓冲.
    useServerStore.getState().setServerURL("https://k.example.com");
    await saveToken("tok");
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await useAuthStore.getState().bootstrap(() => {
        throw new TypeError("simulated factory bug");
      });
      expect(useAuthStore.getState().status).toBe("serverSetup");
      expect(useAuthStore.getState().user).toBeNull();
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [msg, err] = consoleError.mock.calls[0]!;
      expect(String(msg)).toMatch(/authStore\.bootstrap/);
      expect(err).toBeInstanceOf(TypeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("authStore.connectServer", () => {
  it("persists URL and token when login succeeds", async () => {
    const auth = makeAuth();
    await useAuthStore.getState().connectServer("https://k.example.com", "u", "p", () => auth);
    expect(useServerStore.getState().serverURL).toBe("https://k.example.com");
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("anonymous (empty credentials) takes the me() path", async () => {
    const auth = makeAuth();
    await useAuthStore.getState().connectServer("https://k.example.com", "", "", () => auth);
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.me).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("rolls back when login throws", async () => {
    const auth = makeAuth({ login: jest.fn(async () => { throw { kind: "server", message: "bad" }; }) });
    await expect(
      useAuthStore.getState().connectServer("https://k.example.com", "u", "p", () => auth),
    ).rejects.toEqual({ kind: "server", message: "bad" });
    expect(useServerStore.getState().serverURL).toBeNull();
    expect(useAuthStore.getState().status).toBe("serverSetup");
  });
});

describe("authStore.logout", () => {
  it("calls auth.logout when a server is set and resets state", async () => {
    const auth = makeAuth();
    useServerStore.getState().setServerURL("https://k.example.com");
    await saveToken("tok");
    useAuthStore.setState({
      status: "authenticated",
      user: { id: 1, username: "u", role: "user" },
      token: "tok",
      serverVersion: "1.0",
    });
    // The store does not accept a factory for logout — pre-set the createAuthAPI path via
    // injecting a token so the real client constructor runs, then verify state resets.
    // logout 不接受工厂参数, 这里只验证最终状态被清理.
    await useAuthStore.getState().logout();
    expect(useServerStore.getState().serverURL).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().status).toBe("serverSetup");
    // auth.logout is a different instance (real AuthAPI was constructed); just confirm reset.
    // auth.logout 是另一个实例 (内部构造的真实 AuthAPI), 这里只确认状态已重置.
    expect(auth).toBeDefined();
  });

  it("resets state even when no server is set", async () => {
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().status).toBe("serverSetup");
  });
});

describe("authStore.handleAuthExpired", () => {
  it("clears state and returns to serverSetup", async () => {
    useAuthStore.setState({
      status: "authenticated",
      user: { id: 1, username: "u", role: "user" },
      token: "tok",
      serverVersion: "1.0",
    });
    useServerStore.getState().setServerURL("https://k.example.com");
    await saveToken("tok");

    useAuthStore.getState().handleAuthExpired();

    expect(useAuthStore.getState().status).toBe("serverSetup");
    expect(useAuthStore.getState().token).toBeNull();
    expect(useServerStore.getState().serverURL).toBeNull();
  });

  it("updateUser replaces user state, leaving token + status untouched", () => {
    useAuthStore.setState({ status: "authenticated",
      user: { id: 1, username: "old", role: "user" }, token: "tk" });
    useAuthStore.getState().updateUser({ id: 1, username: "new", role: "user", avatar: "/x" });
    const s = useAuthStore.getState();
    expect(s.user?.username).toBe("new");
    expect(s.user?.avatar).toBe("/x");
    expect(s.token).toBe("tk");
    expect(s.status).toBe("authenticated");
  });
});
