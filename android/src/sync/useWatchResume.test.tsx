// useWatchResume tests — the player gate waits for sync, times out, and is ready without a provider.
//
// useWatchResume 测试 — 播放器等待同步, 超时, 以及没有 provider 时直接就绪.

import { act, render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import { SyncValueProvider } from "./SyncContext";
import type { SyncEngine } from "./syncEngine";
import { memorySyncStore } from "./syncTesting";
import { PLAYER_SYNC_WAIT_MS, useWatchResume } from "./useWatchResume";

function Probe({ title }: { title: string }) {
  const { pending, item } = useWatchResume(title);
  return <Text testID="resume">{pending ? "pending" : item ? `${item.episode_index}` : "none"}</Text>;
}

function engineWith(requestSync: SyncEngine["requestSync"]): SyncEngine {
  return { requestSync, flushNow: jest.fn(async () => undefined), start: jest.fn(), stop: jest.fn() };
}

const watch = { title: "Demo Show", cover: "", source_key: "a", video_id: "1", episode: "02", group_index: 0, episode_index: 1, progress_sec: 40, duration_sec: 100, completed: false };

afterEach(() => {
  jest.useRealTimers();
});

describe("useWatchResume", () => {
  it("is ready with no record when no provider is mounted", () => {
    render(<Probe title="Demo Show" />);
    expect(screen.getByTestId("resume")).toHaveTextContent("none");
  });

  it("waits for the player sync before exposing the record", async () => {
    const store = memorySyncStore(1, "alice");
    let finish!: () => void;
    const engine = engineWith(jest.fn(() => new Promise<void>((resolve) => (finish = resolve))));
    render(
      <SyncValueProvider value={{ status: "ready", store, engine }}>
        <Probe title="demo show" />
      </SyncValueProvider>,
    );
    expect(screen.getByTestId("resume")).toHaveTextContent("pending");
    await act(async () => {
      store.upsert("watch", watch);
      finish();
    });
    expect(screen.getByTestId("resume")).toHaveTextContent("1");
    expect(engine.requestSync).toHaveBeenCalledWith("player");
  });

  it("stops waiting after the timeout", async () => {
    jest.useFakeTimers();
    const store = memorySyncStore(1, "alice");
    const engine = engineWith(jest.fn(() => new Promise<void>(() => undefined)));
    render(
      <SyncValueProvider value={{ status: "ready", store, engine }}>
        <Probe title="Demo Show" />
      </SyncValueProvider>,
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PLAYER_SYNC_WAIT_MS);
    });
    expect(screen.getByTestId("resume")).toHaveTextContent("none");
  });
});
