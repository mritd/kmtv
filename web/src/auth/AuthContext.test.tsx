import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createAPIClient } from "@/api/client";
import type { APIClient } from "@/api/client";
import { createMemoryTokenStore } from "@/api/tokenStore";

import { AuthProvider, useAuth } from "./AuthContext";

// Test QueryClient with retry disabled so failed queries do not slow tests.
// 测试用 QueryClient 关闭重试以避免拖慢测试.
function makeTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Consumer() {
  const auth = useAuth();
  return (
    <div>
      <span>{auth.user?.username ?? "none"}</span>
      <button type="button" onClick={() => void auth.login("admin", "admin")}>
        Login
      </button>
      <button type="button" onClick={() => void auth.logout()}>
        Logout
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  it("loads the initial user and updates after logout", async () => {
    const user = userEvent.setup();
    const tokenStore = createMemoryTokenStore({
      accessToken: "Token",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    // Mock api.logout mirrors the real client which clears tokenStore on success.
    // 模拟 api.logout 与真实客户端一致, 成功后清除 tokenStore.
    const api: APIClient = {
      login: vi.fn(),
      logout: vi.fn(async () => { tokenStore.clear("logout"); }),
      me: vi.fn(async () => ({ id: 0, username: "anonymous", role: "user" })),
      getSettings: vi.fn(),
      search: vi.fn(),
      detail: vi.fn(),
      doubanHome: vi.fn(),
      playbackURL: vi.fn(),
    } as unknown as APIClient;

    render(
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={makeTestQueryClient()}>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByText("admin")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Logout" }));

    expect(api.logout).toHaveBeenCalledOnce();
    // The post-logout probe lands on anonymous because me() resolves with id=0.
    // logout 之后的探测命中匿名身份 (me() 返回 id=0).
    await waitFor(() => expect(screen.getByText("anonymous")).toBeInTheDocument());
  });

  it("updates user after login", async () => {
    const user = userEvent.setup();
    const tokenStore = createMemoryTokenStore();
    const api: APIClient = {
      login: vi.fn(async () => {
        const nextUser = { id: 2, username: "new-admin", role: "admin" as const };
        tokenStore.set({
          accessToken: "Token",
          expiresAt: "2026-05-23T12:00:00Z",
          user: nextUser,
        });
        return nextUser;
      }),
      logout: vi.fn(),
      me: vi.fn(async () => ({ id: 0, username: "anonymous", role: "user" })),
      getSettings: vi.fn(),
      search: vi.fn(),
      detail: vi.fn(),
      doubanHome: vi.fn(),
      playbackURL: vi.fn(),
    } as unknown as APIClient;

    render(
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={makeTestQueryClient()}>
        <Consumer />
      </AuthProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(api.login).toHaveBeenCalledWith("admin", "admin");
    expect(screen.getByText("new-admin")).toBeInTheDocument();
  });

  it("throws when the provider is missing", () => {
    expect(() => render(<Consumer />)).toThrow("AuthProvider is missing");
  });

  it("AuthContext reacts to external clear without remount", async () => {
    const tokenStore = createMemoryTokenStore();
    tokenStore.set({ accessToken: "a", expiresAt: "2099", user: { id: 1, username: "x", role: "user" } });

    // me() returns 401 so the post-clear re-probe lands on unauthenticated.
    // me() 返回 401 让外部 clear 之后的重新探测落到 unauthenticated.
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
    const api = createAPIClient({ tokenStore, fetcher });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Probe = () => {
      const auth = useAuth();
      return <span data-testid="user">{auth.user?.username ?? "none"}</span>;
    };

    render(
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("user").textContent).toBe("x");

    tokenStore.clear("unauthorized");

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("none"));
  });
});
