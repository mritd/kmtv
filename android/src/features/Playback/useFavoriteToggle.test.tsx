// useFavoriteToggle tests — favorites are keyed by title and stored in the sync store.
//
// useFavoriteToggle 测试 — 收藏按标题标识并保存在同步存储中.

import { act, renderHook } from "@testing-library/react-native";
import React from "react";

import { SyncTestProvider, memorySyncStore } from "@/sync/syncTesting";

import { useFavoriteToggle } from "./useFavoriteToggle";

const payload = { title: "T", cover: "", type: "Movie", year: "2026", rate: "", desc: "", source_key: "s", video_id: "v" };

describe("useFavoriteToggle", () => {
  it("toggles a title-keyed favorite through the sync store", () => {
    const store = memorySyncStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => <SyncTestProvider store={store}>{children}</SyncTestProvider>;
    const { result } = renderHook(() => useFavoriteToggle(payload), { wrapper });
    expect(result.current.favorited).toBe(false);
    act(() => { result.current.toggle(); });
    expect(result.current.favorited).toBe(true);
    expect(store.get("favorite", " t ")?.payload.source_key).toBe("s");
    act(() => { result.current.toggle(); });
    expect(result.current.favorited).toBe(false);
  });

  it("treats another source of the same title as favorited", () => {
    const store = memorySyncStore();
    store.upsert("favorite", { ...payload, source_key: "other", video_id: "x" });
    const wrapper = ({ children }: { children: React.ReactNode }) => <SyncTestProvider store={store}>{children}</SyncTestProvider>;
    const { result } = renderHook(() => useFavoriteToggle(payload), { wrapper });
    expect(result.current.favorited).toBe(true);
  });

  it("does nothing without a sync session", () => {
    const { result } = renderHook(() => useFavoriteToggle(payload));
    act(() => { expect(result.current.toggle()).toBe(false); });
    expect(result.current.favorited).toBe(false);
  });
});
