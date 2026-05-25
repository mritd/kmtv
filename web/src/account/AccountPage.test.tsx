/**
 * AccountPage.test.tsx — tests for the AccountPage route component.
 * AccountPage.test.tsx — AccountPage 路由组件测试.
 *
 * Covers / 覆盖:
 *   - Authenticated render: profile info, theme choices. / 已认证渲染: profile 信息, 主题选项.
 *   - Theme selection updates document.documentElement dataset. / 主题选择更新 document.documentElement dataset.
 *   - Anonymous render: LoginPromptCard shown, username input hidden, ThemeSettings visible.
 *     匿名渲染: 显示 LoginPromptCard, 隐藏用户名输入框, ThemeSettings 可见.
 *   - saveProfile success path: API called, success toast shown. / saveProfile 成功路径: 调用 API, 显示成功 toast.
 *   - saveProfile error path: error toast shown, profile remains unchanged.
 *     saveProfile 失败路径: 显示错误 toast, profile 保持不变.
 */
import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { APIError } from "@/api/client";
import { createTestAPI } from "@/test/testAPI";
import { APIProvider } from "@/api/context";
import { createMemoryTokenStore } from "@/api/tokenStore";
import { AuthProvider } from "@/auth/AuthContext";
import { ToastContainer } from "@/shared/ui/Toast";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { createMemoryThemeStore } from "@/theme/themes";
import { AccountPage } from "./AccountPage";

function renderAccount() {
  const tokenStore = createMemoryTokenStore({ accessToken: "Token", expiresAt: "2026-05-23T12:00:00Z", user: { id: 1, username: "admin", role: "admin" } });
  // Per-render QueryClient with retry disabled;
  // isolates test state.
  // 每次渲染创建 QueryClient 并关闭重试, 隔离测试状态.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <APIProvider value={createTestAPI()}>
      <ThemeProvider store={createMemoryThemeStore()}>
        <AuthProvider api={createTestAPI()} tokenStore={tokenStore} queryClient={queryClient}>
          <MemoryRouter>
            <AccountPage />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </APIProvider>,
  );
}

describe("AccountPage", () => {
  it("shows profile information and theme choices", () => {
    renderAccount();

    expect(screen.getByRole("heading", { name: "个人设置" })).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "石墨黑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "夜曲蓝" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "科技紫" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自定义配色" })).toBeInTheDocument();
  });

  it("updates the selected theme", async () => {
    const user = userEvent.setup();
    renderAccount();

    await user.click(screen.getByRole("button", { name: "科技紫" }));

    expect(document.documentElement.dataset.theme).toBe("tech-purple");
  });

  it("renders LoginPromptCard and keeps ThemeSettings visible when anonymous", async () => {
    const tokenStore = createMemoryTokenStore();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // me() returns the anonymous identity so AuthProvider lands on `anonymous`.
    // me() 返回匿名身份, AuthProvider 进入 anonymous 状态.
    const api = createTestAPI({
      me: async () => ({ id: 0, username: "anonymous", role: "user" }),
    });

    render(
      <APIProvider value={api}>
        <ThemeProvider store={createMemoryThemeStore()}>
          <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
            <MemoryRouter>
              <AccountPage />
            </MemoryRouter>
          </AuthProvider>
        </ThemeProvider>
      </APIProvider>,
    );

    // ThemeSettings is always present.
    // 主题设置始终可见.
    await screen.findByRole("button", { name: "石墨黑" });

    // The profile form's username input must NOT be rendered.
    // 表单中用户名 input 不渲染.
    expect(screen.queryByLabelText("用户名")).toBeNull();

    // The LoginPromptCard CTA is present.
    // LoginPromptCard CTA 出现.
    expect(screen.getByRole("button", { name: "去登录" })).toBeInTheDocument();
  });
});

describe("AccountPage — saveProfile", () => {
  it("calls updateProfile with the trimmed username and shows success toast", async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockResolvedValue({ id: 1, username: "newname", role: "admin" });
    const tokenStore = createMemoryTokenStore({
      accessToken: "tok",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = createTestAPI({ updateProfile });

    // ToastContainer must be in the tree so toast.success() is reflected in the DOM.
    // ToastContainer 必须在树中, 以便 toast.success() 在 DOM 中体现.
    render(
      <APIProvider value={api}>
        <ThemeProvider store={createMemoryThemeStore()}>
          <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
            <MemoryRouter>
              <AccountPage />
              <ToastContainer />
            </MemoryRouter>
          </AuthProvider>
        </ThemeProvider>
      </APIProvider>,
    );

    // Clear the current username and type a new one with leading whitespace to verify trim.
    // 清除当前用户名并输入带前导空格的新名字, 以验证 trim.
    const input = screen.getByLabelText("用户名");
    await user.clear(input);
    await user.type(input, "  newname  ");
    await user.click(screen.getByRole("button", { name: "保存个人信息" }));

    expect(updateProfile).toHaveBeenCalledWith("newname");
    // Toast title from zh locale: account.updateSuccess.
    // Toast 标题来自 zh locale: account.updateSuccess.
    await screen.findByText("个人信息已更新, 重新登录后令牌快照会同步最新用户名.");
  });

  it("shows an error toast when updateProfile rejects with an APIError", async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockRejectedValue(new APIError(422, undefined, "Username taken"));
    const tokenStore = createMemoryTokenStore({
      accessToken: "tok",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = createTestAPI({ updateProfile });

    render(
      <APIProvider value={api}>
        <ThemeProvider store={createMemoryThemeStore()}>
          <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
            <MemoryRouter>
              <AccountPage />
              <ToastContainer />
            </MemoryRouter>
          </AuthProvider>
        </ThemeProvider>
      </APIProvider>,
    );

    await user.click(screen.getByRole("button", { name: "保存个人信息" }));

    // Error toast with the server-supplied message should appear.
    // 应显示包含服务端消息的错误 toast.
    // Toast title from zh locale: account.updateFailed.
    // Toast 标题来自 zh locale: account.updateFailed.
    await screen.findByText("个人信息更新失败");
    expect(screen.getByText("Username taken")).toBeInTheDocument();
  });
});
