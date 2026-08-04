import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Link, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScrollToTop } from "../ScrollToTop";

// A page tall enough that a real browser could scroll it, with a link onward and a
// back button so a test can drive PUSH and POP through the same router.
// 一个足以产生滚动的高页面, 带有前往下一页的链接与返回按钮,
// 使测试可以在同一个 router 中同时驱动 PUSH 与 POP.
function Page({ name, to }: { name: string; to: string }) {
  // navigate(-1) is what drives a POP here: MemoryRouter keeps its own history and
  // does not listen to window.history, so window.history.back() would do nothing.
  // 这里用 navigate(-1) 触发 POP: MemoryRouter 自持一套 history, 不监听 window.history,
  // 因此 window.history.back() 不会起作用.
  const navigate = useNavigate();
  return (
    <div style={{ height: "3000px" }}>
      <span>{name}</span>
      <Link to={to}>go to {to}</Link>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
    </div>
  );
}

function Harness() {
  return (
    <MemoryRouter initialEntries={["/search"]}>
      <ScrollToTop />
      <Routes>
        <Route path="/search" element={<Page name="search page" to="/detail/abc" />} />
        <Route path="/detail/abc" element={<Page name="detail page" to="/search" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ScrollToTop", () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  let originalScrollTo: typeof window.scrollTo;

  beforeEach(() => {
    scrollTo = vi.fn();
    originalScrollTo = window.scrollTo;
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
  });

  afterEach(() => {
    Object.defineProperty(window, "scrollTo", { configurable: true, value: originalScrollTo });
  });

  it("leaves the first render where the browser put it", () => {
    render(<Harness />);

    // React Router reports the initial navigation as POP, so a reload keeps the
    // position the browser restored rather than being pulled to the top.
    // React Router 将初始导航报告为 POP, 因此刷新时保留浏览器恢复的位置,
    // 而不会被拉回顶部.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("returns to the top when a new route is opened", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("link", { name: "go to /detail/abc" }));

    expect(await screen.findByText("detail page")).toBeInTheDocument();
    // The regression this guards: opening a title from halfway down the search
    // results used to land on the detail page still scrolled, hiding the top of
    // the player behind the sticky nav.
    // 此处防护的回归: 从搜索结果中部点开片子, 进入详情页时仍保持滚动量,
    // 播放器顶部被吸顶导航挡住.
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("does not fight the browser on back navigation", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("link", { name: "go to /detail/abc" }));
    await screen.findByText("detail page");
    scrollTo.mockClear();

    await user.click(screen.getByRole("button", { name: "back" }));
    await screen.findByText("search page");

    // Back and forward are the browser's to restore; scrolling to the top here
    // would throw away the position the user is returning to.
    // 前进与后退的位置恢复归浏览器管; 在此滚到顶部会丢弃用户正要返回的位置.
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
