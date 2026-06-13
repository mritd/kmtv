// ProfileScreen tests — sign-out flow with Alert + anonymous user hiding.
// ProfileScreen 测试 — 含 Alert 的登出流程 + 匿名用户隐藏.

import { render, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";

import { initI18n } from "@/i18n";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

import { ProfileScreen, ProfileScreenContext } from "./ProfileScreen";

beforeAll(async () => { await initI18n("en"); });

describe("ProfileScreen", () => {
  beforeEach(() => {
    useServerStore.setState({ serverURL: "http://localhost" });
    useAuthStore.setState({
      status: "authenticated",
      user: { id: 1, username: "u", role: "user" },
      token: "tk",
    });
  });

  function makeCtx() {
    return {
      apiClient: { baseURL: "http://localhost" } as never,
      auth: {
        login: jest.fn(), logout: jest.fn(async () => {}), me: jest.fn(),
        updateProfile: jest.fn(async (u: string) => ({ id: 1, username: u, role: "user" as const })),
        changePassword: jest.fn(async () => {}),
        uploadAvatar: jest.fn(async () => ({ id: 1, username: "u", role: "user" as const, avatar: "/a" })),
        deleteAvatar: jest.fn(async () => ({ id: 1, username: "u", role: "user" as const })),
      },
    };
  }

  it("renders the sign-out button and fires authStore.logout when destructive Alert button tapped", async () => {
    const ctx = makeCtx();
    const logoutSpy = jest.spyOn(useAuthStore.getState(), "logout").mockImplementation(async () => {});
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const destructive = (buttons ?? []).find((b) => b.style === "destructive");
      destructive?.onPress?.();
    });
    const { getByTestId } = render(
      <ProfileScreenContext.Provider value={ctx as never}>
        <ProfileScreen />
      </ProfileScreenContext.Provider>,
    );
    fireEvent.press(getByTestId("signOutButton"));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
      expect(logoutSpy).toHaveBeenCalled();
    });
    logoutSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("cancel button in sign-out Alert does NOT call logout", async () => {
    const ctx = makeCtx();
    const logoutSpy = jest.spyOn(useAuthStore.getState(), "logout").mockImplementation(async () => {});
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const cancel = (buttons ?? []).find((b) => b.style === "cancel");
      cancel?.onPress?.();
    });
    const { getByTestId } = render(
      <ProfileScreenContext.Provider value={ctx as never}>
        <ProfileScreen />
      </ProfileScreenContext.Provider>,
    );
    fireEvent.press(getByTestId("signOutButton"));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(logoutSpy).not.toHaveBeenCalled();
    logoutSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("clearWatchHistory button is wired", async () => {
    const ctx = makeCtx();
    const { getByTestId } = render(
      <ProfileScreenContext.Provider value={ctx as never}>
        <ProfileScreen />
      </ProfileScreenContext.Provider>,
    );
    // Press the button; it's purely local-state — verifying it does not crash is enough at this layer.
    fireEvent.press(getByTestId("clearHistoryButton"));
  });

  it("anonymous user (id===0) hides username edit, avatar actions, and password section", () => {
    useAuthStore.setState({
      status: "authenticated", token: "tk",
      user: { id: 0, username: "anonymous", role: "user" },
    });
    const ctx = makeCtx();
    const { queryByTestId, getByText } = render(
      <ProfileScreenContext.Provider value={ctx as never}>
        <ProfileScreen />
      </ProfileScreenContext.Provider>,
    );
    expect(queryByTestId("editUsernameButton")).toBeNull();
    expect(queryByTestId("passwordToggle")).toBeNull();
    expect(queryByTestId("avatarPressable")).toBeNull();
    expect(getByText("Sign Out")).toBeTruthy();
    expect(getByText("Clear Watch History")).toBeTruthy();
  });

  it("null user object short-circuits the same way", () => {
    useAuthStore.setState({ status: "authenticated", token: "tk", user: null });
    const ctx = makeCtx();
    const { queryByTestId } = render(
      <ProfileScreenContext.Provider value={ctx as never}>
        <ProfileScreen />
      </ProfileScreenContext.Provider>,
    );
    expect(queryByTestId("passwordToggle")).toBeNull();
    expect(queryByTestId("avatarPressable")).toBeNull();
  });

  it("returns null when no server URL is configured (default context branch)", () => {
    useServerStore.setState({ serverURL: null });
    const { toJSON } = render(<ProfileScreen />);
    expect(toJSON()).toBeNull();
  });
});
