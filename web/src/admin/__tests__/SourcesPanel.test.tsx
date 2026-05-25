/**
 * SourcesPanel tests — happy path, empty state, error state, and key interactions.
 * SourcesPanel 测试 — 正常路径、空状态、错误状态和关键交互.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import type { Source } from "@/api/types";
import { createTestAPI } from "@/test/testAPI";
import { adminModalStore } from "@/store/adminModalStore";

import { SourcesPanel } from "../SourcesPanel";

// Minimal Source fixture reused across cases.
// 跨用例复用的最小 Source 数据.
const healthySource: Source = {
  id: 1,
  key: "src-a",
  name: "Source A",
  api: "https://a.example",
  detail: "",
  enabled: true,
  is_adult: false,
  searchable: true,
  comment: "",
  health: "healthy",
  last_check: "2026-05-16T00:00:00Z",
  created_at: "",
  updated_at: "",
};

// Adult source marked via the structured is_adult field, NOT a name prefix —
// this proves NSFW detection no longer depends on the 🔞 name convention.
// 通过结构化 is_adult 字段标记的成人源, 名称不含 🔞 前缀 — 证明 NSFW 判定不再依赖名称约定.
const disabledNsfwSource: Source = {
  id: 2,
  key: "nsfw-b",
  name: "Adult Source",
  api: "https://b.example",
  detail: "",
  enabled: false,
  is_adult: true,
  searchable: false,
  comment: "",
  health: "unknown",
  last_check: "",
  created_at: "",
  updated_at: "",
};

const disabledSource: Source = {
  id: 3,
  key: "src-c",
  name: "Source C",
  api: "https://c.example",
  detail: "",
  enabled: false,
  is_adult: false,
  searchable: true,
  comment: "",
  health: "unknown",
  last_check: "",
  created_at: "",
  updated_at: "",
};

function renderPanel(overrides: Partial<Parameters<typeof createTestAPI>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = createTestAPI(overrides);
  render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <SourcesPanel />
      </QueryClientProvider>
    </APIProvider>,
  );
  return { api, queryClient };
}

describe("SourcesPanel", () => {
  describe("when sources load successfully", () => {
    it("renders the source name and API URL", async () => {
      renderPanel({
        listSources: async () => ({ sources: [healthySource] }),
      });

      expect(await screen.findByText("Source A")).toBeInTheDocument();
      expect(await screen.findByText("https://a.example")).toBeInTheDocument();
    });

    it("renders an empty table when there are no sources", async () => {
      renderPanel({ listSources: async () => ({ sources: [] }) });

      // The panel heading is always visible; no rows rendered.
      // 面板标题始终可见; 无行渲染.
      expect(await screen.findByRole("heading", { name: "视频源" })).toBeInTheDocument();
      expect(screen.queryByText("Source A")).toBeNull();
    });
  });

  describe("when sources fail to load", () => {
    it("renders an error state", async () => {
      renderPanel({ listSources: async () => Promise.reject(new Error("network error")) });

      // StatusState renders the title as a heading.
      // StatusState 将标题渲染为标题元素.
      expect(await screen.findByRole("heading", { name: "视频源加载失败" })).toBeInTheDocument();
    });
  });

  describe("NSFW sort order", () => {
    it("places non-NSFW sources before NSFW sources", async () => {
      renderPanel({
        listSources: async () => ({
          sources: [disabledNsfwSource, healthySource],
        }),
      });

      const rows = await screen.findAllByText(/Source A|Adult Source/);
      // Source A (non-NSFW) should appear before Adult Source (NSFW).
      // 非 NSFW 的 Source A 应排在 NSFW 的 Adult Source 之前.
      expect(rows[0]).toHaveTextContent("Source A");
      expect(rows[1]).toHaveTextContent("Adult Source");
    });

    it("shows the NSFW badge only for sources with is_adult", async () => {
      renderPanel({
        listSources: async () => ({ sources: [healthySource, disabledNsfwSource] }),
      });

      await screen.findByText("Source A");
      // i18n key source.nsfwBadge = "NSFW"; only the is_adult source is marked.
      // i18n key source.nsfwBadge = "NSFW"; 仅 is_adult 源被标记.
      const badges = screen.getAllByText("NSFW");
      expect(badges).toHaveLength(1);
    });
  });

  describe("bulk actions", () => {
    it("opens source.new modal when 'new source' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({ listSources: async () => ({ sources: [] }) });

      await screen.findByRole("heading", { name: "视频源" });
      await user.click(screen.getByRole("button", { name: "新增视频源" }));

      expect(adminModalStore.getState().current).toEqual({ kind: "source.new" });
    });

    it("opens source.import modal when 'import' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({ listSources: async () => ({ sources: [] }) });

      await screen.findByRole("heading", { name: "视频源" });
      await user.click(screen.getByRole("button", { name: "导入" }));

      expect(adminModalStore.getState().current).toEqual({ kind: "source.import" });
    });

    it("enables every disabled source (not just NSFW) when 'enable all' is clicked", async () => {
      const user = userEvent.setup();
      const bulkSetSourcesEnabled = vi.fn(async (_ids: number[], _enabled: boolean) => undefined);
      renderPanel({
        // Mix of enabled + disabled non-NSFW + disabled NSFW; only the disabled ones are targeted.
        // 混合 启用 + 禁用非 NSFW + 禁用 NSFW; 仅禁用的源会被启用.
        listSources: async () => ({ sources: [healthySource, disabledSource, disabledNsfwSource] }),
        bulkSetSourcesEnabled,
      });

      await screen.findByText("Source A");
      await user.click(screen.getByRole("button", { name: "启用全部源" }));

      await waitFor(() => expect(bulkSetSourcesEnabled).toHaveBeenCalledTimes(1));
      const [ids, enabled] = bulkSetSourcesEnabled.mock.calls[0];
      expect(enabled).toBe(true);
      // Both disabled sources (ids 3 and 2) targeted; the enabled source (id 1) excluded.
      // 两个禁用源 (id 3 和 2) 被启用; 已启用的源 (id 1) 被排除.
      expect([...ids].sort((a, b) => a - b)).toEqual([2, 3]);
    });
  });

  describe("row actions", () => {
    it("opens source.edit modal when 'edit' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({ listSources: async () => ({ sources: [healthySource] }) });

      await screen.findByText("Source A");
      const editBtn = screen.getByRole("button", { name: /编辑.*Source A/i });
      await user.click(editBtn);

      expect(adminModalStore.getState().current).toEqual({ kind: "source.edit", source: healthySource });
    });

    it("calls checkSource when 'check' button is clicked", async () => {
      const user = userEvent.setup();
      const checkSource = vi.fn(async () => ({ health: "healthy" as const }));
      renderPanel({
        listSources: async () => ({ sources: [healthySource] }),
        checkSource,
      });

      await screen.findByText("Source A");
      // aria-label is set by i18n key source.actionsAria.check: "检查 <name>"
      // aria-label 由 i18n key source.actionsAria.check 设置: "检查 <name>"
      const checkBtn = screen.getByRole("button", { name: "检查 Source A" });
      await user.click(checkBtn);

      await waitFor(() => expect(checkSource).toHaveBeenCalledWith(1));
    });
  });
});
