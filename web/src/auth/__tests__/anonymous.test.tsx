import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { APIClient } from "@/api/client";
import { createMemoryTokenStore } from "@/api/tokenStore";

import { AuthProvider, useAuth } from "../AuthContext";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="kind">{auth.status.kind}</span>
      <span data-testid="user">{auth.user?.username ?? "none"}</span>
      <span data-testid="anon">{auth.isAnonymous ? "yes" : "no"}</span>
      <span data-testid="authed">{auth.isAuthenticated ? "yes" : "no"}</span>
    </div>
  );
}

function buildAPI(meImpl: APIClient["me"]): APIClient {
  return {
    login: vi.fn(),
    logout: vi.fn(async () => undefined),
    me: meImpl,
    getSettings: vi.fn(),
    search: vi.fn(),
    detail: vi.fn(),
    doubanHome: vi.fn(),
    playbackURL: vi.fn(),
  } as unknown as APIClient;
}

describe("AuthProvider anonymous mode", () => {
  it("starts in probing, resolves to anonymous when /auth/me returns id=0", async () => {
    const tokenStore = createMemoryTokenStore();
    const api = buildAPI(async () => ({ id: 0, username: "anonymous", role: "user" }));

    render(
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={makeQueryClient()}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("kind").textContent).toBe("probing");

    await waitFor(() => {
      expect(screen.getByTestId("kind").textContent).toBe("anonymous");
    });
    expect(screen.getByTestId("user").textContent).toBe("anonymous");
    expect(screen.getByTestId("anon").textContent).toBe("yes");
    expect(screen.getByTestId("authed").textContent).toBe("no");
  });

  it("resolves to unauthenticated when /auth/me returns 401", async () => {
    const tokenStore = createMemoryTokenStore();
    const api = buildAPI(async () => {
      const err = new Error("Unauthorized") as Error & { status?: number };
      err.status = 401;
      throw err;
    });

    render(
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={makeQueryClient()}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("kind").textContent).toBe("unauthenticated");
    });
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("skips probe when a stored token snapshot is present (authenticated immediately)", async () => {
    const tokenStore = createMemoryTokenStore({
      accessToken: "Token",
      expiresAt: "2099-01-01T00:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    const meSpy = vi.fn();
    const api = buildAPI(meSpy);

    render(
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={makeQueryClient()}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("kind").textContent).toBe("authenticated");
    expect(screen.getByTestId("authed").textContent).toBe("yes");
    expect(meSpy).not.toHaveBeenCalled();
  });

  it("falls back to unauthenticated when /auth/me errors and the network is down", async () => {
    const tokenStore = createMemoryTokenStore();
    const api = buildAPI(async () => {
      throw new Error("Network down");
    });

    render(
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={makeQueryClient()}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("kind").textContent).toBe("unauthenticated");
    });
  });

  it("re-probes after logout so anonymous_access servers fall back to anonymous", async () => {
    const tokenStore = createMemoryTokenStore({
      accessToken: "Token",
      expiresAt: "2099-01-01T00:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    let meCalls = 0;
    const api: APIClient = {
      login: vi.fn(),
      logout: vi.fn(async () => {
        tokenStore.clear("logout");
      }),
      me: vi.fn(async () => {
        meCalls += 1;
        return { id: 0, username: "anonymous", role: "user" };
      }),
      getSettings: vi.fn(),
      search: vi.fn(),
      detail: vi.fn(),
      doubanHome: vi.fn(),
      playbackURL: vi.fn(),
    } as unknown as APIClient;

    function LogoutButton() {
      const auth = useAuth();
      return (
        <button type="button" onClick={() => void auth.logout()}>
          Logout
        </button>
      );
    }

    render(
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={makeQueryClient()}>
        <Probe />
        <LogoutButton />
      </AuthProvider>,
    );

    expect(screen.getByTestId("kind").textContent).toBe("authenticated");
    expect(meCalls).toBe(0);

    screen.getByRole("button", { name: "Logout" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("kind").textContent).toBe("anonymous");
    });
    expect(meCalls).toBe(1);
  });
});
