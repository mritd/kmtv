/**
 * SubscriptionsPanel tests — happy path, empty state, error state, and row interactions.
 * SubscriptionsPanel 测试 — 正常路径、空状态、错误状态和行交互.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import type { Subscription } from "@/api/types";
import { createTestAPI } from "@/test/testAPI";
import { adminModalStore } from "@/store/adminModalStore";

import { SubscriptionsPanel } from "../SubscriptionsPanel";

const sampleSubscription: Subscription = {
  id: 1,
  url: "https://config.example/bundle.json",
  auto_update: true,
  interval: 3600,
  last_sync: "2026-05-16T00:00:00Z",
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
        <SubscriptionsPanel />
      </QueryClientProvider>
    </APIProvider>,
  );
  return { api, queryClient };
}

describe("SubscriptionsPanel", () => {
  describe("when subscriptions load successfully", () => {
    it("renders the subscription URL", async () => {
      renderPanel({
        listSubscriptions: async () => ({ subscriptions: [sampleSubscription] }),
      });

      expect(await screen.findByText("https://config.example/bundle.json")).toBeInTheDocument();
    });

    it("renders an empty table when there are no subscriptions", async () => {
      renderPanel({ listSubscriptions: async () => ({ subscriptions: [] }) });

      expect(await screen.findByRole("heading", { name: "订阅" })).toBeInTheDocument();
      expect(screen.queryByText("https://config.example/bundle.json")).toBeNull();
    });
  });

  describe("when subscriptions fail to load", () => {
    it("renders an error state", async () => {
      renderPanel({ listSubscriptions: async () => Promise.reject(new Error("net error")) });

      expect(await screen.findByRole("heading", { name: "订阅加载失败" })).toBeInTheDocument();
    });
  });

  describe("panel actions", () => {
    it("opens subscription.new modal when 'new subscription' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({ listSubscriptions: async () => ({ subscriptions: [] }) });

      await screen.findByRole("heading", { name: "订阅" });
      // i18n key subscription.newButton = "新增订阅"
      await user.click(screen.getByRole("button", { name: "新增订阅" }));

      expect(adminModalStore.getState().current).toEqual({ kind: "subscription.new" });
    });
  });

  describe("row actions", () => {
    it("calls syncSubscription when 'sync' button is clicked", async () => {
      const user = userEvent.setup();
      const syncSubscription = vi.fn(async () => undefined);
      renderPanel({
        listSubscriptions: async () => ({ subscriptions: [sampleSubscription] }),
        syncSubscription,
      });

      await screen.findByText("https://config.example/bundle.json");
      const syncBtn = screen.getByRole("button", {
        name: /同步.*https:\/\/config\.example\/bundle\.json/i,
      });
      await user.click(syncBtn);

      await waitFor(() => expect(syncSubscription).toHaveBeenCalledWith(1));
    });

    it("opens subscription.edit modal when 'edit' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({
        listSubscriptions: async () => ({ subscriptions: [sampleSubscription] }),
      });

      await screen.findByText("https://config.example/bundle.json");
      const editBtn = screen.getByRole("button", {
        name: /编辑.*https:\/\/config\.example\/bundle\.json/i,
      });
      await user.click(editBtn);

      expect(adminModalStore.getState().current).toEqual({
        kind: "subscription.edit",
        subscription: sampleSubscription,
      });
    });

    it("opens subscription.delete modal when 'delete' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({
        listSubscriptions: async () => ({ subscriptions: [sampleSubscription] }),
      });

      await screen.findByText("https://config.example/bundle.json");
      const deleteBtn = screen.getByRole("button", {
        name: /删除.*https:\/\/config\.example\/bundle\.json/i,
      });
      await user.click(deleteBtn);

      expect(adminModalStore.getState().current).toEqual({
        kind: "subscription.delete",
        subscription: sampleSubscription,
      });
    });
  });
});
