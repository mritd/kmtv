// AdminUsersScreen tests — list / create with confirm / self-delete guard / confirm-then-delete.
// AdminUsersScreen 测试 — 列表、含密码二次确认的创建、禁止自删、二次确认删除.

import { fireEvent, render, waitFor } from "@testing-library/react-native";
import i18next from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { Alert } from "react-native";

import type { AdminAPI } from "@/api/admin";
import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { useAuthStore } from "@/store/authStore";

import { AdminUsersScreen, AdminUsersScreenContext } from "./AdminUsersScreen";

void i18next.init({
  lng: "en",
  resources: {
    en: {
      admin: {
        common: { cancel: "Cancel", delete: "Delete", error: "Error", add: "Add", save: "Save" },
        users: {
          title: "Users", empty: "Empty", add: "Add user", username: "Username",
          password: "Password", passwordConfirm: "Confirm", role: "Role",
          roleAdmin: "Admin", roleUser: "User", allowAdult: "Allow NSFW",
          confirmDeleteTitle: "Delete?", confirmDeleteMessage: "Remove {{username}}?",
          cannotDeleteSelf: "You cannot delete yourself.", passwordMismatch: "Passwords do not match.",
        },
      },
    },
  },
});

function makeAdmin(overrides: Partial<AdminAPI> = {}): AdminAPI {
  const noop = jest.fn(async () => undefined as never);
  return {
    listSources: jest.fn(async () => []),
    updateSource: noop, deleteSource: noop, checkSource: noop, checkAllSources: noop,
    bulkSetSourcesEnabled: noop, importSources: noop,
    listSubscriptions: jest.fn(async () => []),
    createSubscription: noop, syncSubscription: noop, deleteSubscription: noop,
    listUsers: jest.fn(async () => []),
    createUser: noop, deleteUser: noop,
    getSettings: jest.fn(async () => ({})),
    updateSettings: noop,
    ...overrides,
  };
}

function wrap(admin: AdminAPI) {
  return (
    <I18nextProvider i18n={i18next}>
      <ThemeProvider override="light">
        <AdminUsersScreenContext.Provider value={{ admin }}>
          <AdminUsersScreen />
        </AdminUsersScreenContext.Provider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

beforeEach(() => {
  // Tests rely on useAuthStore.user.id for self-delete guard.
  // 测试通过 useAuthStore.user.id 触发自删保护.
  useAuthStore.setState({ user: { id: 1, username: "me", role: "admin" }, token: "t", status: "authenticated" } as never);
});

test("renders users list", async () => {
  const admin = makeAdmin({
    listUsers: jest.fn(async () => [
      { id: 1, username: "root", role: "admin" as const, allow_adult_content: true, created_at: "", updated_at: "" },
      { id: 2, username: "alice", role: "user" as const, allow_adult_content: false, created_at: "", updated_at: "" },
    ]),
  });
  const { findByText, getByText } = render(wrap(admin));
  expect(await findByText("root")).toBeTruthy();
  expect(getByText("alice")).toBeTruthy();
});

test("create rejects password mismatch", async () => {
  const create = jest.fn();
  const admin = makeAdmin({ createUser: create });
  const { findByTestId, getByTestId, findByText } = render(wrap(admin));
  fireEvent.press(await findByTestId("userAddOpen"));
  fireEvent.changeText(getByTestId("userUsernameInput"), "neo");
  fireEvent.changeText(getByTestId("userPasswordInput"), "a");
  fireEvent.changeText(getByTestId("userConfirmInput"), "b");
  fireEvent.press(getByTestId("userSubmit"));
  expect(await findByText("Passwords do not match.")).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
});

test("create POSTs username/password/role/allow_adult_content", async () => {
  const create = jest.fn(async () => ({
    id: 9, username: "neo", role: "user" as const, allow_adult_content: false, created_at: "", updated_at: "",
  }));
  const admin = makeAdmin({ createUser: create });
  const { findByTestId, getByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("userAddOpen"));
  fireEvent.changeText(getByTestId("userUsernameInput"), "neo");
  fireEvent.changeText(getByTestId("userPasswordInput"), "secret");
  fireEvent.changeText(getByTestId("userConfirmInput"), "secret");
  fireEvent.press(getByTestId("userSubmit"));
  await waitFor(() => expect(create).toHaveBeenCalledWith({
    username: "neo", password: "secret", role: "user", allow_adult_content: false,
  }));
});

test("delete current user is blocked client-side", async () => {
  const remove = jest.fn();
  const admin = makeAdmin({
    listUsers: jest.fn(async () => [
      { id: 1, username: "me", role: "admin" as const, allow_adult_content: false, created_at: "", updated_at: "" },
    ]),
    deleteUser: remove,
  });
  const spy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const { findByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("userDelete-1"));
  expect(spy).toHaveBeenCalledWith("Error", "You cannot delete yourself.");
  expect(remove).not.toHaveBeenCalled();
  spy.mockRestore();
});

test("delete other user goes through confirm and dispatches", async () => {
  const remove = jest.fn(async () => undefined as never);
  const admin = makeAdmin({
    listUsers: jest.fn(async () => [
      { id: 2, username: "alice", role: "user" as const, allow_adult_content: false, created_at: "", updated_at: "" },
    ]),
    deleteUser: remove,
  });
  const spy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
    (buttons ?? []).find((b) => b.style === "destructive")?.onPress?.();
  });
  const { findByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("userDelete-2"));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(2));
  spy.mockRestore();
});
