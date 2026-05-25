import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./App";
import { createMemoryTokenStore } from "./api/tokenStore";
import { createTestAPI } from "./test/testAPI";

describe("AppShell", () => {
  it("shows login when no token snapshot exists", async () => {
    render(<AppShell tokenStore={createMemoryTokenStore()} apiClient={createTestAPI()} />);

    // Probe of /auth/me must complete before the unauthenticated branch renders the login form.
    // /auth/me 探测完成后才会渲染 unauthenticated 分支的登录表单.
    expect(await screen.findByRole("heading", { name: "KMTV" })).toBeInTheDocument();
    // Login form is i18n'd (auth namespace, zh test locale) and must not pre-fill credentials.
    // 登录表单已做 i18n (auth 命名空间, 测试语言为 zh), 且不得预填凭据.
    expect(screen.getByLabelText("用户名")).toHaveValue("");
    expect(screen.getByLabelText("密码")).toHaveValue("");
  });

  it("shows lightweight app navigation when a token snapshot exists", () => {
    const tokenStore = createMemoryTokenStore({
      accessToken: "Token",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });

    render(<AppShell tokenStore={tokenStore} apiClient={createTestAPI()} />);

    expect(screen.getByRole("link", { name: "首页" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "搜索" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "收藏" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "管理" })).toBeNull();
  });

  it("opens account and admin entries from the avatar menu", async () => {
    const user = userEvent.setup();
    const tokenStore = createMemoryTokenStore({
      accessToken: "Token",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });

    render(<AppShell tokenStore={tokenStore} apiClient={createTestAPI()} />);

    await user.click(screen.getByRole("button", { name: "账户菜单" }));

    expect(screen.getByRole("link", { name: "个人设置" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: "管理面板" })).toHaveAttribute("href", "/admin");
  });

  it("language switcher in avatar menu changes nav language", async () => {
    const user = userEvent.setup();
    const tokenStore = createMemoryTokenStore({
      accessToken: "Token",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });

    render(<AppShell tokenStore={tokenStore} apiClient={createTestAPI()} />);

    await user.click(screen.getByRole("button", { name: "账户菜单" }));
    await user.click(screen.getByRole("radio", { name: "English" }));

    expect(await screen.findByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "首页" })).toBeNull();
  });

  it("anonymous user clicking the nav login button reaches the login form", async () => {
    const user = userEvent.setup();
    const tokenStore = createMemoryTokenStore();
    // Mock api.me resolves the boot probe to the anonymous identity.
    // api.me 让启动探测落到匿名身份.
    const api = createTestAPI({
      me: async () => ({ id: 0, username: "anonymous", role: "user" }),
    });

    render(<AppShell tokenStore={tokenStore} apiClient={api} />);

    // Wait for the anonymous nav to mount.
    // 等待匿名身份下的导航挂载.
    await screen.findByRole("link", { name: "首页" });

    // Open the avatar popover and click the login button.
    // 打开头像 popover, 点击登录按钮.
    await user.click(screen.getByRole("button", { name: "账户菜单" }));
    await user.click(screen.getByRole("button", { name: "登录" }));

    // The login form must render (we are now on /login).
    // 登录表单出现 (此时已在 /login 上).
    expect(await screen.findByRole("heading", { name: "KMTV" })).toBeInTheDocument();
    expect(screen.getByLabelText("用户名")).toBeInTheDocument();
  });

  it("signs in through the login form", async () => {
    const user = userEvent.setup();
    const tokenStore = createMemoryTokenStore();
    // Mock api.login mirrors the real client:
    // write the token snapshot on success.
    // 模拟 api.login 与真实客户端一致, 成功后写入 token 快照.
    const api = createTestAPI({
      login: vi.fn(async () => {
        const nextUser = { id: 1, username: "admin", role: "admin" as const };
        tokenStore.set({ accessToken: "Token", expiresAt: "2099-01-01T00:00:00Z", user: nextUser });
        return nextUser;
      }),
    });

    render(<AppShell tokenStore={tokenStore} apiClient={api} />);

    // Wait for probe to resolve to unauthenticated and the login button to mount.
    // 等待探测完成进入 unauthenticated 分支, 登录按钮挂载.
    const submit = await screen.findByRole("button", { name: "登录" });
    // Credentials are no longer pre-filled, so the user must type them before submitting.
    // 凭据不再预填, 用户必须先输入再提交.
    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin");
    await user.click(submit);

    expect(api.login).toHaveBeenCalledWith("admin", "admin");
    expect(await screen.findByRole("link", { name: "首页" })).toBeInTheDocument();
  });
});
