/**
 * useWatchResume tests cover the player gate: wait for sync, time out, and identity scoping.
 *
 * useWatchResume 测试覆盖播放器等待逻辑: 等待同步, 超时以及身份隔离.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openSyncStore } from "@/test/syncFixtures";

import { SyncValueProvider, type SyncContextValue } from "./SyncContext";
import type { SyncEngine } from "./syncEngine";
import { PLAYER_SYNC_WAIT_MS, useWatchResume } from "./useWatchResume";

function Probe({ title }: { title: string }) {
  const { pending, item } = useWatchResume(title);
  return <span data-testid="resume">{pending ? "pending" : item ? `${item.episode_index}` : "none"}</span>;
}

function engineWith(requestSync: SyncEngine["requestSync"]): SyncEngine {
  return { requestSync, flushNow: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() };
}

const watch = { title: "Demo Show", cover: "", source_key: "a", video_id: "1", episode: "02", group_index: 0, episode_index: 1, progress_sec: 40, duration_sec: 100, completed: false };

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("useWatchResume", () => {
  it("is pending while auth is probing and ready without a title", () => {
    const { rerender } = render(
      <SyncValueProvider value={{ status: "probing" }}>
        <Probe title="Demo Show" />
      </SyncValueProvider>,
    );
    expect(screen.getByTestId("resume")).toHaveTextContent("pending");
    rerender(
      <SyncValueProvider value={{ status: "disabled" }}>
        <Probe title="Demo Show" />
      </SyncValueProvider>,
    );
    expect(screen.getByTestId("resume")).toHaveTextContent("none");
  });

  it("returns the local record at once when no engine runs", async () => {
    const store = openSyncStore(0, "");
    store.upsert("watch", watch);
    render(
      <SyncValueProvider value={{ status: "ready", store, engine: null }}>
        <Probe title="demo show" />
      </SyncValueProvider>,
    );
    expect(await screen.findByText("1")).toBeInTheDocument();
  });

  it("waits for the player sync before exposing the record", async () => {
    const store = openSyncStore(1, "alice");
    let finish!: () => void;
    const engine = engineWith(vi.fn(() => new Promise<void>((resolve) => (finish = resolve))));
    const value: SyncContextValue = { status: "ready", store, engine };
    render(
      <SyncValueProvider value={value}>
        <Probe title="Demo Show" />
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
    vi.useFakeTimers();
    const store = openSyncStore(1, "alice");
    const engine = engineWith(vi.fn(() => new Promise<void>(() => undefined)));
    render(
      <SyncValueProvider value={{ status: "ready", store, engine }}>
        <Probe title="Demo Show" />
      </SyncValueProvider>,
    );
    expect(screen.getByTestId("resume")).toHaveTextContent("pending");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYER_SYNC_WAIT_MS);
    });
    expect(screen.getByTestId("resume")).toHaveTextContent("none");
  });
});
