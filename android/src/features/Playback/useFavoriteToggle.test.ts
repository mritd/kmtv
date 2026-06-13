// useFavoriteToggle tests.
// useFavoriteToggle 测试.

import { act, renderHook } from "@testing-library/react-native";

import { _resetForTests } from "@/storage/mmkv";
import { useFavoriteToggle } from "./useFavoriteToggle";

describe("useFavoriteToggle", () => {
  beforeEach(() => { _resetForTests(); });
  it("toggles on/off and persists", () => {
    const item = { sourceKey: "s", videoId: "v", title: "T", cover: "", type: "Movie", year: "2026" };
    const { result } = renderHook(() => useFavoriteToggle({ serverURL: "http://x", item }));
    expect(result.current.favorited).toBe(false);
    act(() => { result.current.toggle(); });
    expect(result.current.favorited).toBe(true);
    act(() => { result.current.toggle(); });
    expect(result.current.favorited).toBe(false);
  });
});
