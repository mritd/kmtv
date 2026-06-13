// DiagnosticsScreen tests: empty state, newest-first render, clear button.
// DiagnosticsScreen 测试: 空态、最新在前的渲染、清空按钮.

import { fireEvent, render } from "@testing-library/react-native";
import i18next from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { appendErrorEntry, clearErrorLog } from "@/diagnostics/errorLog";

import { DiagnosticsScreen } from "./DiagnosticsScreen";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    compatibilityJSON: "v4",
    interpolation: { escapeValue: false },
    resources: {
      en: {
        diagnostics: {
          title: "Error Log",
          entryRow: "View Error Log",
          empty: "No recent errors",
          clear: "Clear",
          cleared: "Error log cleared",
          source: { global: "Uncaught", console: "Console" },
        },
      },
    },
  });
});

function wrap(node: React.ReactNode) {
  return (
    <I18nextProvider i18n={i18next}>
      <ThemeProvider override="system">{node}</ThemeProvider>
    </I18nextProvider>
  );
}

beforeEach(() => clearErrorLog());

describe("DiagnosticsScreen", () => {
  it("shows empty placeholder when no entries", () => {
    const { getByText } = render(wrap(<DiagnosticsScreen />));
    expect(getByText("No recent errors")).toBeTruthy();
  });

  it("renders entries newest-first", () => {
    appendErrorEntry({ ts: 1, source: "console", message: "old" });
    appendErrorEntry({ ts: 2, source: "global", message: "new" });
    const { getAllByText } = render(wrap(<DiagnosticsScreen />));
    const messages = getAllByText(/^(old|new)$/);
    expect(messages[0]?.props.children).toBe("new");
    expect(messages[1]?.props.children).toBe("old");
  });

  it("clear wipes the visible list", () => {
    appendErrorEntry({ ts: 1, source: "console", message: "x" });
    const { getByTestId, queryByText, getByText } = render(wrap(<DiagnosticsScreen />));
    expect(getByText("x")).toBeTruthy();
    fireEvent.press(getByTestId("diagnosticsClear"));
    expect(queryByText("x")).toBeNull();
  });
});
