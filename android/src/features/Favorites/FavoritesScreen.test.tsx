// FavoritesScreen tests — empty state, list rendering, navigation, swipe delete.
// FavoritesScreen 测试 — 空态、列表渲染、导航、左滑删除.

import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React, { type ReactElement } from "react";

import { initI18n } from "@/i18n";
import { addFavorite, listFavorites } from "@/storage/favorites";
import { _resetForTests } from "@/storage/mmkv";
import { useServerStore } from "@/store/serverStore";

import { FavoritesScreen } from "./FavoritesScreen";

beforeAll(async () => { await initI18n("en"); });

// FavoritesScreen uses useFocusEffect which requires a NavigationContainer ancestor.
// FavoritesScreen 用了 useFocusEffect, 必须挂在 NavigationContainer 下.
function wrap(child: ReactElement): ReactElement {
  return <NavigationContainer>{child}</NavigationContainer>;
}

describe("FavoritesScreen", () => {
  beforeEach(() => {
    _resetForTests();
    useServerStore.setState({ serverURL: "http://localhost" });
  });

  function mk(over: { videoId?: string; title?: string } = {}) {
    return {
      sourceKey: "s1", videoId: over.videoId ?? "v1", title: over.title ?? "Title",
      cover: "/c.jpg", type: "Movie", year: "2026",
    };
  }

  it("renders empty state when no favorites", () => {
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(wrap(<FavoritesScreen navigation={navigation as never} />));
    expect(getByText("No Favorites")).toBeTruthy();
  });

  it("renders favorites list and navigates to Player on tap", () => {
    addFavorite("http://localhost", mk({ title: "A" }));
    addFavorite("http://localhost", mk({ videoId: "v2", title: "B" }));
    const navigation = { navigate: jest.fn() };
    const { getByTestId, getByText } = render(wrap(<FavoritesScreen navigation={navigation as never} />));
    expect(getByText("B")).toBeTruthy();
    // Newest-first ordering: B is first. Tap it.
    fireEvent.press(getByTestId("favorite-row-s1:v2"));
    expect(navigation.navigate).toHaveBeenCalledWith("Player", expect.objectContaining({
      title: "B", sourceKey: "s1", videoId: "v2",
    }));
  });

  it("renders a delete action for each row and removes the favorite when tapped", async () => {
    addFavorite("http://localhost", mk());
    const navigation = { navigate: jest.fn() };
    const { getByTestId } = render(wrap(<FavoritesScreen navigation={navigation as never} />));
    fireEvent.press(getByTestId("favorite-delete-s1:v1"));
    await waitFor(() => {
      expect(listFavorites("http://localhost")).toHaveLength(0);
    });
  });
});
