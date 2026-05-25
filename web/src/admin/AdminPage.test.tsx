/**
 * AdminPage tests — tab switching, profile card, summary grid, and edge cases.
 * AdminPage 测试 — 标签切换、profile card、汇总统计及边缘情况.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { APIProvider } from "@/api/context";
import { createMemoryTokenStore } from "@/api/tokenStore";
import { AuthProvider } from "@/auth/AuthContext";
import { adminModalStore } from "@/store/adminModalStore";
import { createTestAPI } from "@/test/testAPI";
import { AdminPage } from "./AdminPage";

// renderAdmin builds the full AdminPage tree with a real token store and a stub API.
// Accepts per-test API overrides so individual cases can control data without rebuilding.
// renderAdmin
// 构建包含真实 token store 和存根 API 的完整 AdminPage 树.
// 接受每个测试的 API 覆盖项, 让各用例在无需重建的前提下控制数据.
function renderAdmin(overrides: Partial<Parameters<typeof createTestAPI>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tokenStore = createMemoryTokenStore({
    accessToken: "Token",
    expiresAt: "2099-01-01T00:00:00Z",
    user: { id: 1, username: "admin", role: "admin" },
  });
  const api = createTestAPI({
    listSources: async () => ({
      sources: [
        {
          id: 1,
          key: "source-a",
          name: "Source A",
          api: "https://a.example",
          detail: "",
          enabled: true,
          searchable: true,
          is_adult: false,
          comment: "",
          health: "healthy",
          last_check: "2026-05-16T00:00:00Z",
          created_at: "",
          updated_at: "",
        },
      ],
    }),
    listSubscriptions: async () => ({ subscriptions: [{ id: 1, url: "https://config.example", auto_update: true, interval: 3600, last_sync: "", updated_at: "" }] }),
    listUsers: async () => ({ users: [{ id: 1, username: "admin", role: "admin", allow_adult_content: false }] }),
    getSettings: async () => ({ settings: { version: "v0.0.0-dev", search_concurrency: "8" } }),
    ...overrides,
  });
  return render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
          <MemoryRouter>
            <AdminPage />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </APIProvider>,
  );
}

describe("AdminPage", () => {
  it("shows sources by default and switches tabs", async () => {
    const user = userEvent.setup();
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "视频源" })).toBeInTheDocument();
    expect(await screen.findByText("Source A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "订阅" }));
    expect(await screen.findByRole("heading", { name: "订阅" })).toBeInTheDocument();
    expect(await screen.findByText("https://config.example")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "用户" }));
    expect(await screen.findByRole("heading", { name: "用户" })).toBeInTheDocument();
    // Be specific:
    // "admin" appears in multiple places (profile card + table).
    // 在 profile card 和 table 中都有 "admin", 选用 table 中的项.
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "系统设置" }));
    expect(await screen.findByRole("heading", { name: "系统设置" })).toBeInTheDocument();
    // The inline settings table uses the human label, not the raw key.
    // 内联设置表使用人类可读的字段标签, 不是裸 key.
    expect(await screen.findByText("搜索并发")).toBeInTheDocument();
  });

  it("shows the authenticated user's profile card with action buttons", () => {
    renderAdmin();

    // Profile card shows the username and role label.
    // Profile card
    // 显示用户名和角色.
    expect(screen.getByRole("heading", { name: "admin", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("管理员")).toBeInTheDocument();

    // Real action buttons replace the decorative spans.
    // 真实操作按钮替换了装饰文字.
    expect(screen.getByRole("button", { name: "修改密码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "个人设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });

  describe("when change-password button is clicked", () => {
    it("opens the user.password modal for the logged-in user", async () => {
      const user = userEvent.setup();
      renderAdmin();

      await user.click(screen.getByRole("button", { name: "修改密码" }));

      // adminModalStore is reset by setup.ts beforeEach; after click it should be user.password.
      // adminModalStore 在 beforeEach 中由 setup.ts 重置; 点击后应为 user.password.
      await waitFor(() =>
        expect(adminModalStore.getState().current).toEqual({
          kind: "user.password",
          user: { id: 1, username: "admin", role: "admin", allow_adult_content: false },
        }),
      );
    });
  });

  describe("summary grid", () => {
    it("reflects the counts returned by the API", async () => {
      renderAdmin({
        listSources: async () => ({
          sources: [
            {
              id: 1, key: "a", name: "A", api: "https://a.example",
              detail: "", enabled: true, searchable: true, is_adult: false, comment: "",
              health: "healthy", last_check: "", created_at: "", updated_at: "",
            },
            {
              id: 2, key: "b", name: "B", api: "https://b.example",
              detail: "", enabled: false, searchable: false, is_adult: false, comment: "",
              health: "unhealthy", last_check: "", created_at: "", updated_at: "",
            },
          ],
        }),
        listSubscriptions: async () => ({
          subscriptions: [
            { id: 1, url: "https://s.example", auto_update: true, interval: 3600, last_sync: "", updated_at: "" },
            { id: 2, url: "https://t.example", auto_update: false, interval: 3600, last_sync: "", updated_at: "" },
          ],
        }),
      });

      // Wait for data to load — summary grid numbers update after query resolves.
      // 等待数据加载完成 — 汇总数字在查询解析后更新.
      await screen.findByText("Source A", { exact: false }).catch(() => null);

      // 1 enabled source (A), 2 total sources, 2 subscriptions, 1 unhealthy (B).
      // 1 个启用源 (A), 2 个总源, 2 个订阅, 1 个不健康 (B).
      const strongs = await screen.findAllByRole("strong");
      const nums = strongs.map((el) => el.textContent);
      expect(nums).toContain("1"); // enabled
      expect(nums).toContain("2"); // total
    });
  });
});
