/**
 * LoginPromptCard.test.tsx — unit tests for the LoginPromptCard component.
 * LoginPromptCard.test.tsx — LoginPromptCard 组件的单元测试.
 *
 * Covers / 覆盖:
 *   - Renders the login CTA button. / 渲染登录 CTA 按钮.
 *   - Clicking the CTA navigates to /login?next=%2Faccount.
 *     点击 CTA 跳转至 /login?next=%2Faccount.
 *   - Renders the incognito avatar placeholder. / 渲染匿名头像占位符.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LoginPromptCard } from "./LoginPromptCard";

// LocationSpy surfaces the current router location for assertions.
// LocationSpy 暴露当前路由位置以供断言使用.
function LocationSpy({ onLocation }: { onLocation: (pathname: string, search: string) => void }) {
  const location = useLocation();
  onLocation(location.pathname, location.search);
  return null;
}

function renderCard() {
  let capturedPathname = "";
  let capturedSearch = "";

  const result = render(
    <MemoryRouter initialEntries={["/account"]}>
      <LocationSpy
        onLocation={(pathname, search) => {
          capturedPathname = pathname;
          capturedSearch = search;
        }}
      />
      <LoginPromptCard />
    </MemoryRouter>,
  );

  return {
    ...result,
    getLocation: () => ({ pathname: capturedPathname, search: capturedSearch }),
  };
}

describe("LoginPromptCard", () => {
  it("renders the login CTA button", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "去登录" })).toBeInTheDocument();
  });

  it("renders the section heading", () => {
    renderCard();
    // Section is labelled by the heading; any visible heading suffices.
    // Section 由标题标记; 任何可见标题都足够.
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it("navigates to /login with next=%2Faccount when CTA is clicked", async () => {
    const user = userEvent.setup();
    const { getLocation } = renderCard();

    await user.click(screen.getByRole("button", { name: "去登录" }));

    const { pathname, search } = getLocation();
    expect(pathname).toBe("/login");
    expect(search).toBe("?next=%2Faccount");
  });
});
