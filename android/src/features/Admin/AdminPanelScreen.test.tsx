// AdminPanelScreen tests — gates non-admin, renders four navigation rows for admin.
// AdminPanelScreen 测试 — 非管理员被阻挡, 管理员看到四个导航行.

// jest hoists jest.mock() factories above all variable declarations, so any reference inside the
// factory MUST start with the `mock` prefix. mockNavigate is the supported escape hatch.
// jest 会把 jest.mock() factory 提升至所有变量声明之前. factory 内的引用必须以 mock 开头.
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render } from "@testing-library/react-native";
import i18next from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { useAuthStore } from "@/store/authStore";

import { AdminPanelScreen } from "./AdminPanelScreen";

void i18next.init({
  lng: "en",
  resources: {
    en: {
      admin: {
        panel: { sources: "Sources", subscriptions: "Subscriptions", users: "Users", settings: "System Settings", title: "Admin" },
        common: { forbidden: "Forbidden" },
      },
    },
  },
});

function wrap(node: React.ReactElement) {
  return (
    <I18nextProvider i18n={i18next}>
      <ThemeProvider override="light"><NavigationContainer>{node}</NavigationContainer></ThemeProvider>
    </I18nextProvider>
  );
}

beforeEach(() => { mockNavigate.mockClear(); });

test("forbidden notice when role != admin", () => {
  useAuthStore.setState({ user: { id: 1, username: "u", role: "user" }, token: "t", status: "authenticated" } as never);
  const { getByTestId, queryByTestId } = render(wrap(<AdminPanelScreen />));
  expect(getByTestId("adminForbidden")).toBeTruthy();
  expect(queryByTestId("adminPanel-sources")).toBeNull();
});

test("renders four rows and navigates on tap (admin)", () => {
  useAuthStore.setState({ user: { id: 1, username: "u", role: "admin" }, token: "t", status: "authenticated" } as never);
  const { getByTestId } = render(wrap(<AdminPanelScreen />));
  ["sources", "subscriptions", "users", "settings"].forEach((slug) =>
    expect(getByTestId(`adminPanel-${slug}`)).toBeTruthy());
  fireEvent.press(getByTestId("adminPanel-users"));
  expect(mockNavigate).toHaveBeenCalledWith("AdminUsers");
});
