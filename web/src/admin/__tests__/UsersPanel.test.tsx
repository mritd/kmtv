/**
 * UsersPanel tests — happy path, empty state, error state, and row interactions.
 * UsersPanel 测试 — 正常路径、空状态、错误状态和行交互.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { APIProvider } from "@/api/context";
import type { AdminUser } from "@/api/types";
import { createTestAPI } from "@/test/testAPI";
import { adminModalStore } from "@/store/adminModalStore";

import { UsersPanel } from "../UsersPanel";

const adminUser: AdminUser = { id: 1, username: "alice", role: "admin", allow_adult_content: true };
const normalUser: AdminUser = { id: 2, username: "bob", role: "user", allow_adult_content: false };

function renderPanel(overrides: Partial<Parameters<typeof createTestAPI>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = createTestAPI(overrides);
  render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <UsersPanel />
      </QueryClientProvider>
    </APIProvider>,
  );
  return { api, queryClient };
}

describe("UsersPanel", () => {
  describe("when users load successfully", () => {
    it("renders all user rows with username and role", async () => {
      renderPanel({
        listUsers: async () => ({ users: [adminUser, normalUser] }),
      });

      expect(await screen.findByText("alice")).toBeInTheDocument();
      expect(await screen.findByText("bob")).toBeInTheDocument();
    });

    it("shows the NSFW badge only for users allowed adult content", async () => {
      renderPanel({
        listUsers: async () => ({ users: [adminUser, normalUser] }),
      });

      await screen.findByText("alice");
      // i18n key user.adultBadge = "NSFW"; alice is allowed, bob is not.
      // i18n key user.adultBadge = "NSFW"; alice 允许, bob 不允许.
      const badges = screen.getAllByText("NSFW");
      expect(badges).toHaveLength(1);
      expect(badges[0]).toHaveClass("status-pill-on");
    });

    it("renders an empty table when there are no users", async () => {
      renderPanel({ listUsers: async () => ({ users: [] }) });

      expect(await screen.findByRole("heading", { name: "用户" })).toBeInTheDocument();
      expect(screen.queryByText("alice")).toBeNull();
    });
  });

  describe("when users fail to load", () => {
    it("renders an error state", async () => {
      renderPanel({ listUsers: async () => Promise.reject(new Error("forbidden")) });

      expect(await screen.findByRole("heading", { name: "用户加载失败" })).toBeInTheDocument();
    });
  });

  describe("panel actions", () => {
    it("opens user.new modal when 'new user' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({ listUsers: async () => ({ users: [] }) });

      await screen.findByRole("heading", { name: "用户" });
      // i18n key user.newButton = "新增用户"
      await user.click(screen.getByRole("button", { name: "新增用户" }));

      expect(adminModalStore.getState().current).toEqual({ kind: "user.new" });
    });
  });

  describe("row actions", () => {
    it("opens user.edit modal when 'edit' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({ listUsers: async () => ({ users: [adminUser] }) });

      await screen.findByText("alice");
      await user.click(screen.getByRole("button", { name: /编辑.*alice/i }));

      expect(adminModalStore.getState().current).toEqual({ kind: "user.edit", user: adminUser });
    });

    it("opens user.password modal when 'change password' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({ listUsers: async () => ({ users: [adminUser] }) });

      await screen.findByText("alice");
      // i18n key user.actionsAria.password = "修改 <username> 的密码"
      // i18n key user.actionsAria.password = "修改 <username> 的密码"
      await user.click(screen.getByRole("button", { name: "修改 alice 的密码" }));

      expect(adminModalStore.getState().current).toEqual({
        kind: "user.password",
        user: adminUser,
      });
    });

    it("opens user.delete modal when 'delete' button is clicked", async () => {
      const user = userEvent.setup();
      renderPanel({ listUsers: async () => ({ users: [adminUser] }) });

      await screen.findByText("alice");
      // i18n key user.actionsAria.delete = "删除 <username>"
      // i18n key user.actionsAria.delete = "删除 <username>"
      await user.click(screen.getByRole("button", { name: "删除 alice" }));

      expect(adminModalStore.getState().current).toEqual({ kind: "user.delete", user: adminUser });
    });
  });
});
