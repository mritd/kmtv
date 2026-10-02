// FavoritesScreen tests — empty state, newest-first list, navigation, delete through the sync store.
//
// FavoritesScreen 测试 — 空态, 最新优先的列表, 导航, 通过同步存储删除.

import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React, { type ReactElement } from "react";

import { initI18n } from "@/i18n";
import { useServerStore } from "@/store/serverStore";
import type { SyncEngine } from "@/sync/syncEngine";
import type { SyncStore } from "@/sync/syncStore";
import { SyncTestProvider, memorySyncStore } from "@/sync/syncTesting";
import type { FavoritePayload } from "@/sync/types";

import { FavoritesScreen } from "./FavoritesScreen";

beforeAll(async () => { await initI18n("en"); });

function favorite(over: Partial<FavoritePayload> = {}): FavoritePayload {
  return { title: "Title", cover: "/c.jpg", type: "Movie", year: "2026", rate: "", desc: "", source_key: "s1", video_id: "v1", ...over };
}

// FavoritesScreen uses useFocusEffect which requires a NavigationContainer ancestor.
//
// FavoritesScreen 用了 useFocusEffect, 必须挂在 NavigationContainer 下.
function wrap(store: SyncStore, child: ReactElement, engine: SyncEngine | null = null): ReactElement {
  return (
    <NavigationContainer>
      <SyncTestProvider store={store} engine={engine}>{child}</SyncTestProvider>
    </NavigationContainer>
  );
}

describe("FavoritesScreen", () => {
  beforeEach(() => {
    useServerStore.setState({ serverURL: "http://localhost" });
  });

  it("renders empty state when no favorites", () => {
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(wrap(memorySyncStore(), <FavoritesScreen navigation={navigation as never} />));
    expect(getByText("No Favorites")).toBeTruthy();
  });

  it("lists favorites newest first and opens the saved source in the player", () => {
    const store = memorySyncStore();
    store.upsert("favorite", favorite({ title: "A" }));
    store.upsert("favorite", favorite({ title: "B", video_id: "v2" }));
    const navigation = { navigate: jest.fn() };
    const { getByTestId, getAllByText } = render(wrap(store, <FavoritesScreen navigation={navigation as never} />));
    expect(getAllByText(/^[AB]$/).map((node) => node.props.children)).toEqual(["B", "A"]);
    fireEvent.press(getByTestId("favorite-row-b"));
    expect(navigation.navigate).toHaveBeenCalledWith("Player", expect.objectContaining({
      title: "B", sourceKey: "s1", videoId: "v2", sources: [],
    }));
  });

  it("opens search for favorites without a source", () => {
    const store = memorySyncStore();
    store.upsert("favorite", favorite({ title: "Web Only", source_key: "", video_id: "" }));
    const navigation = { navigate: jest.fn() };
    const { getByTestId } = render(wrap(store, <FavoritesScreen navigation={navigation as never} />));
    fireEvent.press(getByTestId("favorite-row-web only"));
    expect(navigation.navigate).toHaveBeenCalledWith("Search", { initialQuery: "Web Only" });
  });

  it("requests a page sync when the screen gains focus", () => {
    const engine = { requestSync: jest.fn(async () => undefined), flushNow: jest.fn(async () => undefined), start: jest.fn(), stop: jest.fn() };
    const navigation = { navigate: jest.fn() };
    render(wrap(memorySyncStore(), <FavoritesScreen navigation={navigation as never} />, engine));
    expect(engine.requestSync).toHaveBeenCalledWith("page");
  });

  it("removes a favorite through the sync store", async () => {
    const store = memorySyncStore();
    store.upsert("favorite", favorite());
    const navigation = { navigate: jest.fn() };
    const { getByTestId } = render(wrap(store, <FavoritesScreen navigation={navigation as never} />));
    fireEvent.press(getByTestId("favorite-delete-title"));
    await waitFor(() => expect(store.list("favorite")).toHaveLength(0));
    expect(store.state().records["favorite|title"]).toMatchObject({ deleted: true, dirty: true });
  });
});
