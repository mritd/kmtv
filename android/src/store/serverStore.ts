// English. 中文.
// serverStore exposes the currently selected server URL as zustand state.
// serverStore 将当前选择的服务器 URL 以 zustand 状态形式暴露.

import { create } from "zustand";

import { clearServerURL as wipe, loadServerURL, saveServerURL } from "../storage/server";

interface ServerState {
  serverURL: string | null;
  setServerURL: (url: string) => void;
  clearServerURL: () => void;
  hydrate: () => void;
}

/**
 * Zustand store for the active server URL, persisted via MMKV.
 * 通过 MMKV 持久化的当前服务器 URL zustand store.
 */
export const useServerStore = create<ServerState>((set) => ({
  serverURL: null,
  setServerURL: (url) => {
    saveServerURL(url);
    set({ serverURL: url });
  },
  clearServerURL: () => {
    wipe();
    set({ serverURL: null });
  },
  hydrate: () => {
    set({ serverURL: loadServerURL() });
  },
}));
