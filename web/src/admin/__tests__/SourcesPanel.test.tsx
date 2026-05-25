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
  searchable: true,
  comment: "",
  health: "healthy",
  last_check: "2026-05-16T00:00:00Z",
  created_at: "",
  updated_at: "",
};

const disabledNsfwSource: Source = {
  id: 2,
  key: "nsfw-b",
  name: "🔞 Adult Source",
  api: "https://b.example",
  detail: "",
  enabled: false,
  searchable: false,
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
