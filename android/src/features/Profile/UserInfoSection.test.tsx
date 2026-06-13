// UserInfoSection tests — non-anonymous + anonymous + avatar Alert handling.
// UserInfoSection 测试 — 非匿名 + 匿名 + 头像 Alert 操作.

import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";

import { initI18n } from "@/i18n";

import { UserInfoSection } from "./UserInfoSection";
import type { UseProfileResult } from "./useProfile";

beforeAll(async () => { await initI18n("en"); });

function stub(over: Partial<UseProfileResult> = {}): UseProfileResult {
  return {
    isEditingUsername: false, editUsername: "",
    passwordCurrent: "", passwordNext: "", passwordConfirm: "",
    watchHistoryCount: 0, errorMessage: "", successMessage: "",
    startEditUsername: jest.fn(), cancelEditUsername: jest.fn(),
    setEditUsername: jest.fn(), submitUsername: jest.fn(async () => {}),
    setPasswordCurrent: jest.fn(), setPasswordNext: jest.fn(), setPasswordConfirm: jest.fn(),
    submitPassword: jest.fn(async () => {}),
    pickAndUploadAvatar: jest.fn(async () => {}), deleteAvatar: jest.fn(async () => {}),
    refreshWatchCount: jest.fn(), clearWatchHistory: jest.fn(),
    dismissError: jest.fn(), dismissSuccess: jest.fn(),
    ...over,
  };
}

describe("UserInfoSection", () => {
  it("non-anonymous user shows pencil + tappable avatar + role badge", () => {
    const profile = stub();
    const { getByTestId } = render(
      <UserInfoSection
        user={{ id: 1, username: "u", role: "user" }}
        isAnonymous={false}
        apiClient={null}
        serverURL="http://localhost"
        profile={profile}
      />,
    );
    expect(getByTestId("editUsernameButton")).toBeTruthy();
    expect(getByTestId("avatarPressable")).toBeTruthy();
    expect(getByTestId("roleBadge")).toBeTruthy();
  });

  it("anonymous user hides pencil + avatar tap target + role badge", () => {
    const profile = stub();
    const { queryByTestId, getByTestId } = render(
      <UserInfoSection
        user={{ id: 0, username: "anonymous", role: "user" }}
        isAnonymous={true}
        apiClient={null}
        serverURL="http://localhost"
        profile={profile}
      />,
    );
    expect(queryByTestId("editUsernameButton")).toBeNull();
    expect(queryByTestId("avatarPressable")).toBeNull();
    expect(queryByTestId("roleBadge")).toBeNull();
    expect(getByTestId("anonymousUserLabel")).toBeTruthy();
  });

  it("tap avatar -> Alert -> Change Avatar fires pickAndUploadAvatar", async () => {
    const profile = stub();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const change = (buttons ?? []).find((b) => b.text === "Change Avatar");
      change?.onPress?.();
    });
    const { getByTestId } = render(
      <UserInfoSection
        user={{ id: 1, username: "u", role: "user" }}
        isAnonymous={false}
        apiClient={null}
        serverURL="http://localhost"
        profile={profile}
      />,
    );
    fireEvent.press(getByTestId("avatarPressable"));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
      expect(profile.pickAndUploadAvatar).toHaveBeenCalled();
    });
    alertSpy.mockRestore();
  });

  it("tap avatar -> Alert -> Remove Avatar fires deleteAvatar (only when avatar set)", async () => {
    const profile = stub();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const remove = (buttons ?? []).find((b) => b.text === "Remove Avatar");
      remove?.onPress?.();
    });
    const { getByTestId } = render(
      <UserInfoSection
        user={{ id: 1, username: "u", role: "user", avatar: "/api/v1/avatar/u" }}
        isAnonymous={false}
        apiClient={null}
        serverURL="http://localhost"
        profile={profile}
      />,
    );
    fireEvent.press(getByTestId("avatarPressable"));
    await waitFor(() => {
      expect(profile.deleteAvatar).toHaveBeenCalled();
    });
    alertSpy.mockRestore();
  });

  it("username row pencil -> check fires submitUsername; X fires cancelEditUsername", () => {
    const profile = stub({ isEditingUsername: true, editUsername: "new" });
    const { getByTestId } = render(
      <UserInfoSection
        user={{ id: 1, username: "u", role: "user" }}
        isAnonymous={false}
        apiClient={null}
        serverURL="http://localhost"
        profile={profile}
      />,
    );
    fireEvent.press(getByTestId("confirmUsernameButton"));
    expect(profile.submitUsername).toHaveBeenCalled();
    fireEvent.press(getByTestId("cancelUsernameButton"));
    expect(profile.cancelEditUsername).toHaveBeenCalled();
  });

  it("pencil starts editing via startEditUsername", () => {
    const profile = stub();
    const { getByTestId } = render(
      <UserInfoSection
        user={{ id: 1, username: "u", role: "user" }}
        isAnonymous={false}
        apiClient={null}
        serverURL="http://localhost"
        profile={profile}
      />,
    );
    fireEvent.press(getByTestId("editUsernameButton"));
    expect(profile.startEditUsername).toHaveBeenCalled();
  });
});
