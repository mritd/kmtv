// Tests for the serverStore that mirrors persisted server URL into reactive state.
// 将持久化服务器 URL 映射为响应式状态的 serverStore 测试.

import { clearServerURL } from "../storage/server";
import { useServerStore } from "./serverStore";

describe("serverStore", () => {
  beforeEach(() => {
    clearServerURL();
    useServerStore.setState({ serverURL: null });
  });

  it("starts with null serverURL", () => {
    expect(useServerStore.getState().serverURL).toBeNull();
  });

  it("setServerURL persists and updates state", () => {
    useServerStore.getState().setServerURL("https://kmtv.example.com");
    expect(useServerStore.getState().serverURL).toBe("https://kmtv.example.com");
  });

  it("clearServerURL wipes state and storage", () => {
    useServerStore.getState().setServerURL("https://kmtv.example.com");
    useServerStore.getState().clearServerURL();
    expect(useServerStore.getState().serverURL).toBeNull();
  });

  it("hydrate loads the persisted URL", () => {
    useServerStore.getState().setServerURL("https://kmtv.example.com");
    useServerStore.setState({ serverURL: null });
    useServerStore.getState().hydrate();
    expect(useServerStore.getState().serverURL).toBe("https://kmtv.example.com");
  });
});
