/**
 * AppRoutes tests - regression coverage for rapid route transitions.
 *
 * AppRoutes tests - 快速路由切换的回归测试.
 */

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({
    status: { kind: "anonymous", user: { id: 0, username: "anonymous", role: "user" } },
    user: { id: 0, username: "anonymous", role: "user" },
    isAnonymous: true,
    isAuthenticated: false,
  }),
}));

vi.mock("./AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <>
      <NavigationProbe />
      {children}
    </>
  ),
}));

vi.mock("@/viewer/home/HomePage", () => ({ HomePage: () => <div>home-page</div> }));
const routeChunks = vi.hoisted(() => {
  function deferred() {
    let resolve!: () => void;
    const pending = new Promise<void>((resolvePending) => {
      resolve = resolvePending;
    });
    return { pending, resolve };
  }

  return { categories: deferred(), search: deferred() };
});
vi.mock("@/viewer/search/SearchPage", async () => {
  await routeChunks.search.pending;
  return { SearchPage: () => <div>search-page</div> };
});
vi.mock("@/viewer/categories/CategoriesPage", async () => {
  await routeChunks.categories.pending;
  return { CategoriesPage: () => <div>categories-page</div> };
});
vi.mock("@/viewer/detail/DetailPage", () => ({ DetailPage: () => <div>detail-page</div> }));
vi.mock("@/viewer/favorites/FavoritesPage", () => ({ FavoritesPage: () => <div>favorites-page</div> }));
vi.mock("@/account/AccountPage", () => ({ AccountPage: () => <div>account-page</div> }));
vi.mock("@/admin/AdminPage", () => ({ AdminPage: () => <div>admin-page</div> }));

import { AppRoutes } from "./AppRoutes";

function NavigationProbe() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <>
      <button type="button" onClick={() => navigate("/categories")}>
        go-categories
      </button>
      <button type="button" onClick={() => navigate("/search")}>
        go-search
      </button>
      <output aria-label="location">{location.pathname}</output>
    </>
  );
}

describe("AppRoutes", () => {
  test("rapid navigation renders the page for the latest location", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText("home-page")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "go-categories" }));
    await waitFor(() => expect(screen.getByLabelText("location")).toHaveTextContent("/categories"));
    expect(await screen.findByLabelText("Loading")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "go-search" }));

    await waitFor(() => expect(screen.getByLabelText("location")).toHaveTextContent("/search"));
    await act(async () => routeChunks.categories.resolve());
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 50)));
    expect(screen.queryByText("categories-page")).not.toBeInTheDocument();
    await act(async () => routeChunks.search.resolve());
    await waitFor(() => expect(screen.getByText("search-page")).toBeInTheDocument(), { timeout: 1500 });
    expect(screen.queryByText("categories-page")).not.toBeInTheDocument();
  });
});
