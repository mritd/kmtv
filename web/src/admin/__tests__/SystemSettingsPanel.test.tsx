/**
 * SystemSettingsPanel tests — happy path, error state, edit/cancel flow, and validation.
 * SystemSettingsPanel 测试 — 正常路径、错误状态、编辑/取消流程和字段校验.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import { createTestAPI } from "@/test/testAPI";

import { SystemSettingsPanel } from "../SystemSettingsPanel";

// Minimal settings map covering both a number field and a boolean field.
// 覆盖数字字段和布尔字段的最小配置映射.
const baseSettings = {
  search_concurrency: "8",
  anonymous_access: "false",
  health_check_interval: "120",
  adult_filter_enabled: "true",
  douban_image_proxy: "tencent",
  probe_concurrency: "4",
  probe_timeout: "10",
  search_timeout: "15",
  public_base_url: "",
  access_token_ttl: "604800",
  media_token_ttl: "3600",
  playback_mode: "direct",
  site_name: "KMTV",
  version: "v0.0.0-dev",
};

function renderPanel(overrides: Partial<Parameters<typeof createTestAPI>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = createTestAPI({
    getSettings: async () => ({ settings: baseSettings }),
    ...overrides,
  });
  render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <SystemSettingsPanel />
      </QueryClientProvider>
    </APIProvider>,
  );
  return { api, queryClient };
}

describe("SystemSettingsPanel", () => {
  describe("when settings load successfully", () => {
    it("renders settings fields in read-only mode by default", async () => {
      renderPanel();

      // The human-readable label for search_concurrency is "搜索并发".
      // search_concurrency 的人类可读标签是 "搜索并发".
      expect(await screen.findByText("搜索并发")).toBeInTheDocument();
      // In read-only mode there are no <input> fields.
      // 只读模式下不应有 <input> 字段.
      expect(screen.queryByRole("spinbutton")).toBeNull();
    });

    it("shows the version string at the bottom", async () => {
      renderPanel();

      // Version line: "版本: v0.0.0-dev"
      // 版本行: "版本: v0.0.0-dev"
      expect(await screen.findByText("v0.0.0-dev", { exact: false })).toBeInTheDocument();
    });
  });

  describe("when settings fail to load", () => {
    it("renders an error state", async () => {
      renderPanel({ getSettings: async () => Promise.reject(new Error("server error")) });

      expect(await screen.findByRole("heading", { name: "系统设置加载失败" })).toBeInTheDocument();
    });
  });

  describe("edit / cancel flow", () => {
    it("switches to edit mode when 'edit' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel();

      await screen.findByText("搜索并发");
      await user.click(screen.getByRole("button", { name: "编辑" }));

      // In edit mode number inputs are rendered.
      // 编辑模式下数字输入框出现.
      expect(screen.getAllByRole("spinbutton").length).toBeGreaterThan(0);
    });

    it("restores original values when 'cancel' is clicked", async () => {
      const user = userEvent.setup();
      renderPanel();

      await screen.findByText("搜索并发");
      await user.click(screen.getByRole("button", { name: "编辑" }));

      // Change the search_concurrency field (aria-label = the key, not the label).
      // 修改 search_concurrency 字段 (aria-label = key, 非标签).
      const concurrencyInput = screen.getByRole("spinbutton", { name: "search_concurrency" });
      await user.clear(concurrencyInput);
      await user.type(concurrencyInput, "99");
      expect(concurrencyInput).toHaveValue(99);

      await user.click(screen.getByRole("button", { name: "取消" }));

      // Back to read-only mode; no inputs.
      // 回到只读模式; 无输入框.
      expect(screen.queryByRole("spinbutton")).toBeNull();
    });

    it("submits only the changed diff and closes edit mode", async () => {
      const user = userEvent.setup();
      const updateSettings = vi.fn(async () => undefined);
      renderPanel({ updateSettings });

      await screen.findByText("搜索并发");
      await user.click(screen.getByRole("button", { name: "编辑" }));

      const concurrencyInput = screen.getByRole("spinbutton", { name: "search_concurrency" });
      await user.clear(concurrencyInput);
      await user.type(concurrencyInput, "12");

      await user.click(screen.getByRole("button", { name: "保存" }));

      await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
      // Only the changed key is submitted — not the entire settings map.
      // 只提交变更的键, 而非整个配置映射.
      expect(updateSettings).toHaveBeenLastCalledWith({ search_concurrency: "12" });

      // After successful save, returns to read-only mode.
      // 成功保存后回到只读模式.
      await waitFor(() => expect(screen.queryByRole("spinbutton")).toBeNull());
    });

    it("does not call updateSettings when nothing changed", async () => {
      const user = userEvent.setup();
      const updateSettings = vi.fn(async () => undefined);
      renderPanel({ updateSettings });

      await screen.findByText("搜索并发");
      await user.click(screen.getByRole("button", { name: "编辑" }));

      // Submit without changing anything.
      // 不修改任何内容直接提交.
      await user.click(screen.getByRole("button", { name: "保存" }));

      expect(updateSettings).not.toHaveBeenCalled();
      // Still exits edit mode.
      // 仍然退出编辑模式.
      await waitFor(() => expect(screen.queryByRole("spinbutton")).toBeNull());
    });
  });

  describe("field validation", () => {
    it("shows a validation error when search_concurrency is below min (1)", async () => {
      const user = userEvent.setup();
      const updateSettings = vi.fn(async () => undefined);
      renderPanel({ updateSettings });

      await screen.findByText("搜索并发");
      await user.click(screen.getByRole("button", { name: "编辑" }));

      const concurrencyInput = screen.getByRole("spinbutton", { name: "search_concurrency" });
      await user.clear(concurrencyInput);
      await user.type(concurrencyInput, "0");
      await user.click(screen.getByRole("button", { name: "保存" }));

      // Validation error appears; updateSettings is NOT called.
      // 校验错误出现; updateSettings 不被调用.
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it("shows a validation error when search_concurrency is above max (50)", async () => {
      const user = userEvent.setup();
      const updateSettings = vi.fn(async () => undefined);
      renderPanel({ updateSettings });

      await screen.findByText("搜索并发");
      await user.click(screen.getByRole("button", { name: "编辑" }));

      const concurrencyInput = screen.getByRole("spinbutton", { name: "search_concurrency" });
      await user.clear(concurrencyInput);
      await user.type(concurrencyInput, "51");
      await user.click(screen.getByRole("button", { name: "保存" }));

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(updateSettings).not.toHaveBeenCalled();
    });
  });
});
