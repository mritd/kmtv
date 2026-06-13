// AdminSourcesScreen tests — list / toggle / check-all / bulk enable-disable / delete-with-confirm.
// AdminSourcesScreen 测试 — 列表、开关、全部检查、批量启用禁用、二次确认删除.

import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import i18next from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { Alert } from "react-native";

import type { AdminAPI } from "@/api/admin";
import { ThemeProvider } from "@/designSystem/ThemeProvider";

import { AdminSourcesScreen, AdminSourcesScreenContext } from "./AdminSourcesScreen";

void i18next.init({
  lng: "en",
  resources: {
    en: {
      admin: {
        common: { cancel: "Cancel", delete: "Delete", error: "Error", nsfw: "NSFW", enabled: "On", disabled: "Off" },
        sources: {
          title: "Sources", empty: "Empty", checkAll: "Check All", checkAllStarted: "Started",
          enableAll: "Enable All", disableAll: "Disable All",
          healthHealthy: "OK", healthUnhealthy: "Bad", healthUnknown: "?",
          confirmDeleteTitle: "Delete?", confirmDeleteMessage: "Bye {{name}}",
          lastCheck: "Last check: {{when}}",
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
        <AdminSourcesScreenContext.Provider value={{ admin }}>
          <AdminSourcesScreen />
        </AdminSourcesScreenContext.Provider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

test("loads sources and renders rows", async () => {
  const admin = makeAdmin({
    listSources: jest.fn(async () => [
      { id: 1, key: "k", name: "Alpha", api: "a", detail: "d", enabled: true, is_adult: false,
        searchable: true, comment: "", health: "healthy", last_check: "2026-06-13T00:00:00Z",
        created_at: "", updated_at: "" },
    ]),
  });
  expect(await render(wrap(admin)).findByText("Alpha")).toBeTruthy();
});

test("toggle dispatches updateSource with FULL payload", async () => {
  const update = jest.fn(async () => undefined as never);
  const admin = makeAdmin({
    listSources: jest.fn()
      .mockResolvedValueOnce([{
        id: 9, key: "k", name: "A", api: "a", detail: "d", enabled: true, is_adult: false,
        searchable: true, comment: "c", health: "healthy", last_check: "", created_at: "", updated_at: "",
      }])
      .mockResolvedValueOnce([]),
    updateSource: update,
  });
  const { findByTestId } = render(wrap(admin));
  const toggle = await findByTestId("sourceToggle-9");
  await act(async () => { fireEvent(toggle, "valueChange", false); });
  await waitFor(() => expect(update).toHaveBeenCalledWith(9, {
    name: "A", api: "a", detail: "d", comment: "c", enabled: false, is_adult: false,
  }));
});

test("delete confirms then calls deleteSource", async () => {
  const remove = jest.fn(async () => undefined as never);
  const admin = makeAdmin({
    listSources: jest.fn(async () => [
      { id: 3, key: "k", name: "Gone", api: "", detail: "", enabled: true, is_adult: false,
        searchable: true, comment: "", health: "unknown", last_check: "", created_at: "", updated_at: "" },
    ]),
    deleteSource: remove,
  });
  const spy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
    (buttons ?? []).find((b) => b.style === "destructive")?.onPress?.();
  });
  const { findByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("sourceDelete-3"));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(3));
  spy.mockRestore();
});

test("check-all dispatches and refetches after 5s delay", async () => {
  jest.useFakeTimers();
  const checkAll = jest.fn(async () => undefined as never);
  const list = jest.fn(async () => []);
  const admin = makeAdmin({ listSources: list, checkAllSources: checkAll });
  const { findByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("sourceCheckAll"));
  await waitFor(() => expect(checkAll).toHaveBeenCalled());
  await act(async () => { jest.advanceTimersByTime(5000); });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  jest.useRealTimers();
});

test("Enable All sends bulk-enabled with all visible IDs and enabled=true", async () => {
  const bulk = jest.fn(async () => undefined as never);
  const admin = makeAdmin({
    listSources: jest.fn(async () => [
      { id: 1, key: "a", name: "A", api: "", detail: "", enabled: false, is_adult: false,
        searchable: true, comment: "", health: "", last_check: "", created_at: "", updated_at: "" },
      { id: 2, key: "b", name: "B", api: "", detail: "", enabled: false, is_adult: false,
        searchable: true, comment: "", health: "", last_check: "", created_at: "", updated_at: "" },
    ]),
    bulkSetSourcesEnabled: bulk,
  });
  const { findByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("sourceEnableAll"));
  await waitFor(() => expect(bulk).toHaveBeenCalledWith({ ids: [1, 2], enabled: true }));
});

test("Disable All sends bulk-enabled with enabled=false", async () => {
  const bulk = jest.fn(async () => undefined as never);
  const admin = makeAdmin({
    listSources: jest.fn(async () => [
      { id: 5, key: "a", name: "A", api: "", detail: "", enabled: true, is_adult: false,
        searchable: true, comment: "", health: "", last_check: "", created_at: "", updated_at: "" },
    ]),
    bulkSetSourcesEnabled: bulk,
  });
  const { findByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("sourceDisableAll"));
  await waitFor(() => expect(bulk).toHaveBeenCalledWith({ ids: [5], enabled: false }));
});
