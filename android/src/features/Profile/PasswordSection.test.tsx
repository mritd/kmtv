// PasswordSection tests — toggle, change, submit.
// PasswordSection 测试 — 折叠/展开、修改、提交.

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { initI18n } from "@/i18n";

import { PasswordSection } from "./PasswordSection";
import type { UseProfileResult } from "./useProfile";

beforeAll(async () => { await initI18n("en"); });

function stubProfile(over: Partial<UseProfileResult> = {}): UseProfileResult {
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

describe("PasswordSection", () => {
  it("renders only the toggle when collapsed", () => {
    const profile = stubProfile();
    const { queryByTestId, getByTestId } = render(<PasswordSection profile={profile} />);
    expect(getByTestId("passwordToggle")).toBeTruthy();
    expect(queryByTestId("passwordCurrent")).toBeNull();
  });

  it("expands and dispatches setters + submit", () => {
    const profile = stubProfile();
    const { getByTestId } = render(<PasswordSection profile={profile} />);
    fireEvent.press(getByTestId("passwordToggle"));
    fireEvent.changeText(getByTestId("passwordCurrent"), "old");
    fireEvent.changeText(getByTestId("passwordNext"), "new");
    fireEvent.changeText(getByTestId("passwordConfirm"), "new");
    fireEvent.press(getByTestId("passwordSave"));
    expect(profile.setPasswordCurrent).toHaveBeenCalledWith("old");
    expect(profile.setPasswordNext).toHaveBeenCalledWith("new");
    expect(profile.setPasswordConfirm).toHaveBeenCalledWith("new");
    expect(profile.submitPassword).toHaveBeenCalled();
  });
});
