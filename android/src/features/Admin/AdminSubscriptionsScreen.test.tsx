// AdminSubscriptionsScreen tests — list / create / sync / delete-with-confirm.
// AdminSubscriptionsScreen 测试 — 列表、创建、同步、二次确认删除.

import { fireEvent, render, waitFor } from "@testing-library/react-native";
import i18next from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { Alert } from "react-native";

import type { AdminAPI } from "@/api/admin";
import { ThemeProvider } from "@/designSystem/ThemeProvider";

import { AdminSubscriptionsScreen, AdminSubscriptionsScreenContext } from "./AdminSubscriptionsScreen";

void i18next.init({
  lng: "en",
  resources: {
    en: {
      admin: {
        common: { cancel: "Cancel", delete: "Delete", error: "Error", add: "Add", save: "Save" },
        subscriptions: {
          title: "Subscriptions", empty: "Empty", add: "Add subscription", url: "URL",
          interval: "Interval", autoUpdate: "Auto-update", lastSync: "Last sync: {{when}}",
          sync: "Sync", confirmDeleteTitle: "Delete?", confirmDeleteMessage: "Remove {{url}}?",
          invalidUrl: "URL must start with http:// or https://",
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
        <AdminSubscriptionsScreenContext.Provider value={{ admin }}>
          <AdminSubscriptionsScreen />
        </AdminSubscriptionsScreenContext.Provider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

test("renders existing subscriptions", async () => {
  const admin = makeAdmin({
    listSubscriptions: jest.fn(async () => [
      { id: 5, url: "https://x", auto_update: true, interval: 86400, last_sync: "", updated_at: "" },
    ]),
  });
  expect(await render(wrap(admin)).findByText("https://x")).toBeTruthy();
});

test("create rejects bad url then accepts good one", async () => {
  const createSub = jest.fn(async () => ({
    id: 1, url: "https://x", auto_update: true, interval: 60, last_sync: "", updated_at: "",
  }));
  const admin = makeAdmin({ createSubscription: createSub });
  const { getByTestId, findByText, findByTestId } = render(wrap(admin));
  // Wait for the initial empty-list fetch to settle so the loading spinner unmounts.
  // 等待初始空列表 fetch 完成, 让 loading spinner 卸载.
  fireEvent.press(await findByTestId("subAddOpen"));
  fireEvent.changeText(getByTestId("subUrlInput"), "ftp://nope");
  fireEvent.changeText(getByTestId("subIntervalInput"), "60");
  fireEvent.press(getByTestId("subSubmit"));
  expect(await findByText("URL must start with http:// or https://")).toBeTruthy();
  expect(createSub).not.toHaveBeenCalled();

  fireEvent.changeText(getByTestId("subUrlInput"), "https://x");
  fireEvent.press(getByTestId("subSubmit"));
  await waitFor(() => expect(createSub).toHaveBeenCalledWith({
    url: "https://x", auto_update: true, interval: 60,
  }));
});

test("sync now calls syncSubscription with row id", async () => {
  const sync = jest.fn(async () => undefined as never);
  const admin = makeAdmin({
    listSubscriptions: jest.fn(async () => [
      { id: 9, url: "https://x", auto_update: true, interval: 60, last_sync: "", updated_at: "" },
    ]),
    syncSubscription: sync,
  });
  const { findByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("subSync-9"));
  await waitFor(() => expect(sync).toHaveBeenCalledWith(9));
});

test("delete confirms then calls deleteSubscription", async () => {
  const remove = jest.fn(async () => undefined as never);
  const admin = makeAdmin({
    listSubscriptions: jest.fn(async () => [
      { id: 7, url: "https://x", auto_update: true, interval: 60, last_sync: "", updated_at: "" },
    ]),
    deleteSubscription: remove,
  });
  const spy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
    (buttons ?? []).find((b) => b.style === "destructive")?.onPress?.();
  });
  const { findByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("subDelete-7"));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(7));
  spy.mockRestore();
});
