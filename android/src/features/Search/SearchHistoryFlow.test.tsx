// SearchHistoryFlow renders empty / chips / Clear button + onSelect propagation.
// SearchHistoryFlow 渲染空态、胶囊与清空按钮, 验证 onSelect 传递.

import { fireEvent, render, screen } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";
import React from "react";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { initI18n } from "@/i18n";

import { SearchHistoryFlow } from "./SearchHistoryFlow";

async function renderFlow(props: React.ComponentProps<typeof SearchHistoryFlow>) {
  const i18n = await initI18n("en");
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider override="light">
        <SearchHistoryFlow {...props} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("SearchHistoryFlow", () => {
  it("renders nothing when history is empty", async () => {
    await renderFlow({ history: [], onSelect: jest.fn(), onClear: jest.fn() });
    expect(screen.queryByText("Search history")).toBeNull();
  });

  it("renders each entry as a chip and fires onSelect", async () => {
    const onSelect = jest.fn();
    await renderFlow({
      history: [{ query: "foo", searchedAt: 1 }, { query: "bar", searchedAt: 2 }],
      onSelect,
      onClear: jest.fn(),
    });
    fireEvent.press(screen.getByText("foo"));
    expect(onSelect).toHaveBeenCalledWith("foo");
  });

  it("fires onClear when Clear pressed", async () => {
    const onClear = jest.fn();
    await renderFlow({ history: [{ query: "foo", searchedAt: 1 }], onSelect: jest.fn(), onClear });
    fireEvent.press(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
