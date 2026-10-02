// FavoriteRow tests.
//
// FavoriteRow 测试.

import { render, fireEvent } from "@testing-library/react-native";
import React from "react";

import { initI18n } from "@/i18n";
import type { LocalRecord } from "@/sync/types";

import { FavoriteRow } from "./FavoriteRow";

beforeAll(async () => { await initI18n("en"); });

describe("FavoriteRow", () => {
  const item: LocalRecord<"favorite"> = {
    kind: "favorite", key: "title", eventTimeMs: 1, deleted: false, dirty: false, synced: true,
    payload: { title: "Title", cover: "/c.jpg", type: "Movie", year: "2026", rate: "", desc: "", source_key: "s1", video_id: "v1" },
  };
  it("renders title + subtitle and dispatches onPress with the item", () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = render(
      <FavoriteRow testID="row" item={item} serverURL="http://localhost" onPress={onPress} />,
    );
    expect(getByText("Title")).toBeTruthy();
    expect(getByText("Movie | 2026")).toBeTruthy();
    fireEvent.press(getByTestId("row"));
    expect(onPress).toHaveBeenCalledWith(item);
  });
});
