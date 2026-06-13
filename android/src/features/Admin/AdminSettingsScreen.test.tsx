// AdminSettingsScreen tests — fetch -> edit -> diff-only PUT, clamp, URL validation.
// AdminSettingsScreen 测试 — 拉取 -> 编辑 -> 仅 diff PUT, 含 clamp 与 URL 校验.

import { fireEvent, render, waitFor } from "@testing-library/react-native";
import i18next from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";

import type { AdminAPI } from "@/api/admin";
import { ThemeProvider } from "@/designSystem/ThemeProvider";

import { AdminSettingsScreen, AdminSettingsScreenContext } from "./AdminSettingsScreen";

void i18next.init({
  lng: "en",
  resources: {
    en: {
      admin: {
        common: { cancel: "Cancel", save: "Save", error: "Error" },
        settings: {
          title: "Settings", edit: "Edit", cancel: "Cancel", save: "Save",
          invalidUrl: "Bad URL", outOfRange: "Range {{min}}..{{max}}",
          labels: {
            site_name: "Site name", anonymous_access: "Anonymous", health_check_interval: "Health interval",
            nsfw_filter_enabled: "NSFW filter", douban_image_proxy: "Douban proxy",
            search_concurrency: "Search concurrency", probe_concurrency: "Probe concurrency",
            probe_timeout: "Probe timeout", search_timeout: "Search timeout",
            public_base_url: "Public URL", access_token_ttl: "Access TTL",
            media_token_ttl: "Media TTL", playback_mode: "Playback",
          },
          doubanImageProxy: { direct: "Direct", server: "Server", tencent: "Tencent", ali: "Ali" },
          playbackMode: { direct: "Direct", proxy: "Proxy" },
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
    getSettings: jest.fn(async () => ({
      site_name: "Old", anonymous_access: "true", search_concurrency: "20",
      public_base_url: "https://a.b", playback_mode: "proxy",
    })),
    updateSettings: noop,
    ...overrides,
  };
}

function wrap(admin: AdminAPI) {
  return (
    <I18nextProvider i18n={i18next}>
      <ThemeProvider override="light">
        <AdminSettingsScreenContext.Provider value={{ admin }}>
          <AdminSettingsScreen />
        </AdminSettingsScreenContext.Provider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

test("save diff-only after editing a text field", async () => {
  const update = jest.fn(async () => undefined as never);
  const admin = makeAdmin({ updateSettings: update });
  const { findByTestId, getByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("settingsEdit"));
  fireEvent.changeText(getByTestId("settingsInput-site_name"), "New");
  fireEvent.press(getByTestId("settingsSave"));
  await waitFor(() => expect(update).toHaveBeenCalledWith({ site_name: "New" }));
});

test("invalid URL blocks save", async () => {
  const update = jest.fn();
  const admin = makeAdmin({ updateSettings: update });
  const { findByTestId, getByTestId, findByText } = render(wrap(admin));
  fireEvent.press(await findByTestId("settingsEdit"));
  fireEvent.changeText(getByTestId("settingsInput-public_base_url"), "ftp://nope");
  fireEvent.press(getByTestId("settingsSave"));
  expect(await findByText("Bad URL")).toBeTruthy();
  expect(update).not.toHaveBeenCalled();
});

test("number clamps on save", async () => {
  const update = jest.fn(async () => undefined as never);
  const admin = makeAdmin({ updateSettings: update });
  const { findByTestId, getByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("settingsEdit"));
  fireEvent.changeText(getByTestId("settingsInput-search_concurrency"), "999");
  fireEvent.press(getByTestId("settingsSave"));
  await waitFor(() => expect(update).toHaveBeenCalledWith({ search_concurrency: "50" }));
});

test("toggle boolean issues string 'false'", async () => {
  const update = jest.fn(async () => undefined as never);
  const admin = makeAdmin({ updateSettings: update });
  const { findByTestId, getByTestId } = render(wrap(admin));
  fireEvent.press(await findByTestId("settingsEdit"));
  fireEvent(getByTestId("settingsInput-anonymous_access"), "valueChange", false);
  fireEvent.press(getByTestId("settingsSave"));
  await waitFor(() => expect(update).toHaveBeenCalledWith({ anonymous_access: "false" }));
});
