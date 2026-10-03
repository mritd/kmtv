// SyncContext tests — scope selection from auth and server stores, launch sync, AppState flushes, cleanup.
//
// SyncContext 测试 — 依据认证和服务器状态选择作用域, 启动同步, AppState 补写和清理.

import { act, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { AppState, Text } from "react-native";

import { getNamespacedStorage, _resetForTests } from "@/storage/mmkv";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

import { stopActiveSyncEngine } from "./activeSyncEngine";
import { SyncProvider, useSync, useSyncList } from "./SyncContext";
import type { SyncEngine, SyncTransport } from "./syncEngine";
import type { SyncStore } from "./syncStore";
import type { SyncPullResponse, SyncPushRequest } from "./types";
import { PLAYER_SYNC_WAIT_MS, useWatchResume } from "./useWatchResume";

let readyStore: SyncStore | null = null;
let readyEngine: SyncEngine | null = null;

function Probe() {
  const sync = useSync();
  const searches = useSyncList("search");
  readyStore = sync.status === "ready" ? sync.store : null;
  readyEngine = sync.status === "ready" ? sync.engine : null;
  return (
    <>
      <Text testID="status">{sync.status}</Text>
      <Text testID="scope">{sync.status === "ready" ? sync.store.scopeKey : ""}</Text>
      <Text testID="engine">{sync.status === "ready" && sync.engine ? "on" : "off"}</Text>
      <Text testID="searches">{searches.map((r) => r.payload.query).join(",")}</Text>
    </>
  );
}

function fakeTransport(pull: () => Promise<SyncPullResponse> = async () => emptyPull()) {
  const push = jest.fn(async (body: SyncPushRequest) => ({
    epoch: "e1",
    rev: body.changes.length,
    server_time_ms: Date.now(),
    results: body.changes.map((_change, index) => ({ index, status: "applied" as const, record: null })),
  }));
  return { push, pull: jest.fn(pull) } satisfies SyncTransport;
}

function emptyPull(): SyncPullResponse {
  return { epoch: "e1", server_time_ms: Date.now(), rev: 0, reset: false, has_more: false, clears: [], records: [] };
}

function GateProbe() {
  const { pending } = useWatchResume("Demo Show");
  return <Text testID="gate">{pending ? "pending" : "ready"}</Text>;
}

const compatible = async () => true;

function signIn(id: number, username: string) {
  useAuthStore.setState({ status: "authenticated", token: "tk", user: { id, username, role: "user" } });
}

beforeEach(() => {
  _resetForTests();
  readyStore = null;
  readyEngine = null;
  useServerStore.setState({ serverURL: "http://srv" });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("SyncProvider", () => {
  it("is probing while auth loads and disabled without a server session", () => {
    useAuthStore.setState({ status: "loading", user: null, token: null });
    const { rerender } = render(<SyncProvider checkServer={compatible} createTransport={() => fakeTransport()}><Probe /></SyncProvider>);
    expect(screen.getByTestId("status")).toHaveTextContent("probing");
    act(() => useAuthStore.setState({ status: "serverSetup" }));
    rerender(<SyncProvider checkServer={compatible} createTransport={() => fakeTransport()}><Probe /></SyncProvider>);
    expect(screen.getByTestId("status")).toHaveTextContent("disabled");
  });

  it("opens the anonymous scope without an engine", () => {
    signIn(0, "anonymous");
    const createTransport = jest.fn(() => fakeTransport());
    render(<SyncProvider checkServer={compatible} createTransport={createTransport}><Probe /></SyncProvider>);
    expect(screen.getByTestId("scope")).toHaveTextContent("kmtv.sync.v1:http://srv:0");
    expect(screen.getByTestId("engine")).toHaveTextContent("off");
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("opens the signed-in scope and syncs on launch", async () => {
    signIn(5, "alice");
    const transport = fakeTransport();
    render(<SyncProvider checkServer={compatible} createTransport={() => transport}><Probe /></SyncProvider>);
    expect(screen.getByTestId("scope")).toHaveTextContent("kmtv.sync.v1:http://srv:5");
    expect(screen.getByTestId("engine")).toHaveTextContent("on");
    await waitFor(() => expect(transport.pull).toHaveBeenCalled());
  });

  it("switches scope when the signed-in user changes", () => {
    signIn(5, "alice");
    // A pull that never settles keeps the launch sync from updating the store after the test ends.
    //
    // 永不完成的拉取可避免启动同步在测试结束后更新存储.
    const idle = () => fakeTransport(() => new Promise<never>(() => undefined));
    render(<SyncProvider checkServer={compatible} createTransport={idle}><Probe /></SyncProvider>);
    act(() => {
      readyStore!.upsert("search", { query: "alice only" });
    });
    expect(screen.getByTestId("searches")).toHaveTextContent("alice only");
    act(() => signIn(6, "bob"));
    expect(screen.getByTestId("scope")).toHaveTextContent("kmtv.sync.v1:http://srv:6");
    expect(screen.getByTestId("searches").props.children).toBe("");
  });

  it("flushes when the app leaves the foreground and syncs when it returns", async () => {
    signIn(5, "alice");
    let onChange: ((state: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      onChange = handler as (state: string) => void;
      return { remove: jest.fn() } as never;
    });
    const pending = () => new Promise<never>(() => undefined);
    const transport = fakeTransport(async () => emptyPull());
    render(<SyncProvider checkServer={compatible} createTransport={() => transport}><Probe /></SyncProvider>);
    await waitFor(() => expect(transport.pull).toHaveBeenCalledTimes(1));
    transport.pull.mockImplementation(pending);
    act(() => {
      readyStore!.upsert("search", { query: "pending" });
    });
    await act(async () => {
      onChange?.("background");
    });
    expect(transport.push).toHaveBeenCalledTimes(1);
    expect(transport.push.mock.calls[0]![0].changes).toMatchObject([{ kind: "search", op: "upsert" }]);

    await act(async () => {
      onChange?.("active");
    });
    expect(transport.pull).toHaveBeenCalledTimes(2);
    await act(async () => {
      onChange?.("active");
    });
    expect(transport.pull).toHaveBeenCalledTimes(2);
  });

  it("keeps the data local when the server is too old to sync", async () => {
    signIn(5, "alice");
    const transport = fakeTransport();
    const onIncompatibleServer = jest.fn();
    render(
      <SyncProvider checkServer={async () => false} onIncompatibleServer={onIncompatibleServer} createTransport={() => transport}>
        <Probe />
      </SyncProvider>,
    );
    await waitFor(() => expect(onIncompatibleServer).toHaveBeenCalledTimes(1));
    act(() => {
      readyStore!.upsert("search", { query: "local" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(transport.pull).not.toHaveBeenCalled();
    expect(transport.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("searches")).toHaveTextContent("local");
  });

  it("stops queueing sync waiters once the server is too old", async () => {
    signIn(5, "alice");
    const transport = fakeTransport();
    const onIncompatibleServer = jest.fn();
    render(
      <SyncProvider checkServer={async () => false} onIncompatibleServer={onIncompatibleServer} createTransport={() => transport}>
        <Probe />
      </SyncProvider>,
    );
    await waitFor(() => expect(onIncompatibleServer).toHaveBeenCalledTimes(1));
    let settled = false;
    await act(async () => {
      void readyEngine!.requestSync("player").then(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(settled).toBe(true);
    expect(transport.pull).not.toHaveBeenCalled();
  });

  it("keeps a player gate opened during the server check waiting for the launch sync", async () => {
    signIn(5, "alice");
    let answer: (compatible: boolean) => void = () => undefined;
    const checkServer = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    let finishPull: (page: SyncPullResponse) => void = () => undefined;
    const transport = fakeTransport(() => new Promise<SyncPullResponse>((resolve) => (finishPull = resolve)));
    render(<SyncProvider checkServer={checkServer} createTransport={() => transport}><GateProbe /></SyncProvider>);
    await waitFor(() => expect(checkServer).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId("gate")).toHaveTextContent("pending");

    await act(async () => {
      answer(true);
    });
    await waitFor(() => expect(transport.pull).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("gate")).toHaveTextContent("pending");
    await act(async () => {
      finishPull(emptyPull());
    });
    expect(screen.getByTestId("gate")).toHaveTextContent("ready");
    expect(transport.pull).toHaveBeenCalledTimes(1);
  });

  it("bounds the wait of a player gate when the server check never answers", async () => {
    jest.useFakeTimers();
    signIn(5, "alice");
    const checkServer = jest.fn(() => new Promise<boolean>(() => undefined));
    const transport = fakeTransport();
    render(<SyncProvider checkServer={checkServer} createTransport={() => transport}><GateProbe /></SyncProvider>);
    expect(screen.getByTestId("gate")).toHaveTextContent("pending");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PLAYER_SYNC_WAIT_MS);
    });
    expect(screen.getByTestId("gate")).toHaveTextContent("ready");
    expect(transport.pull).not.toHaveBeenCalled();
  });

  it("stops the engine before logout waits for the server", async () => {
    signIn(5, "alice");
    const transport = fakeTransport();
    render(<SyncProvider checkServer={compatible} createTransport={() => transport}><Probe /></SyncProvider>);
    await waitFor(() => expect(transport.pull).toHaveBeenCalledTimes(1));
    stopActiveSyncEngine();
    act(() => {
      readyStore!.upsert("search", { query: "after logout" });
    });
    await act(async () => {
      await readyEngine!.flushNow();
    });
    expect(transport.push).not.toHaveBeenCalled();
  });

  it("never starts the engine when logout runs before the server check answers", async () => {
    signIn(5, "alice");
    let answer: (compatible: boolean) => void = () => undefined;
    const checkServer = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const transport = fakeTransport();
    render(<SyncProvider checkServer={checkServer} createTransport={() => transport}><Probe /></SyncProvider>);
    await waitFor(() => expect(checkServer).toHaveBeenCalledTimes(1));
    const start = jest.spyOn(readyEngine!, "start");
    stopActiveSyncEngine();
    await act(async () => {
      answer(true);
    });
    act(() => {
      readyStore!.upsert("search", { query: "after logout" });
    });
    await act(async () => {
      await readyEngine!.flushNow();
    });
    expect(start).not.toHaveBeenCalled();
    expect(transport.pull).not.toHaveBeenCalled();
    expect(transport.push).not.toHaveBeenCalled();
  });

  it("sends nothing when the scope closes before the server check answers", async () => {
    signIn(5, "alice");
    let answer: (compatible: boolean) => void = () => undefined;
    const checkServer = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const transport = fakeTransport();
    const { unmount } = render(<SyncProvider checkServer={checkServer} createTransport={() => transport}><Probe /></SyncProvider>);
    await waitFor(() => expect(checkServer).toHaveBeenCalledTimes(1));
    const start = jest.spyOn(readyEngine!, "start");
    unmount();
    await act(async () => {
      answer(true);
    });
    expect(start).not.toHaveBeenCalled();
    expect(transport.pull).not.toHaveBeenCalled();
    expect(transport.push).not.toHaveBeenCalled();
  });

  it("binds the transport to the scope's user", () => {
    signIn(5, "alice");
    const createTransport = jest.fn(() => fakeTransport(() => new Promise<never>(() => undefined)));
    render(<SyncProvider checkServer={compatible} createTransport={createTransport}><Probe /></SyncProvider>);
    expect(createTransport).toHaveBeenCalledWith("http://srv", 5);
  });

  it("shares one scope between spellings of the same server URL", () => {
    useServerStore.setState({ serverURL: "http://SRV/" });
    signIn(5, "alice");
    render(<SyncProvider checkServer={compatible} createTransport={() => fakeTransport(() => new Promise<never>(() => undefined))}><Probe /></SyncProvider>);
    expect(screen.getByTestId("scope")).toHaveTextContent("kmtv.sync.v1:http://srv:5");
  });

  it("deletes legacy keys from the server's MMKV", () => {
    getNamespacedStorage("http://srv").set("kmtv:favorites", "[]");
    signIn(5, "alice");
    render(<SyncProvider checkServer={compatible} createTransport={() => fakeTransport(() => new Promise<never>(() => undefined))}><Probe /></SyncProvider>);
    expect(getNamespacedStorage("http://srv").getString("kmtv:favorites")).toBeUndefined();
  });
});
