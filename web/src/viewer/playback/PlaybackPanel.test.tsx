import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlaybackState } from "./playbackState";
import { PlaybackPanel } from "./PlaybackPanel";

const artplayerMock = vi.hoisted(() => {
  const instances: Array<{ option: Record<string, unknown>; on: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  const ArtPlayer = vi.fn(function (this: unknown, option: Record<string, unknown>) {
    const instance = { option, on: vi.fn(), destroy: vi.fn() };
    instances.push(instance);
    return instance;
  });
  return { ArtPlayer, instances };
});

vi.mock("artplayer", () => ({ default: artplayerMock.ArtPlayer }));

const readyState: PlaybackState = {
  status: "ready",
  groupIndex: 0,
  episodeIndex: 0,
  selectedEpisode: { name: "01", url: "https://cdn.example/1.m3u8" },
  url: "https://proxy.example/1.m3u8",
  mode: "direct",
  error: null,
};

describe("PlaybackPanel", () => {
  it("mounts ArtPlayer instead of native video controls when playback URL is ready", async () => {
    const { container } = render(<PlaybackPanel state={readyState} sourceName="🎬iKun资源" onPlaying={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getByLabelText("ArtPlayer 播放器")).toBeInTheDocument();
    expect(container.querySelector("video[controls]")).toBeNull();
    expect(await screen.findByLabelText("ArtPlayer 播放器")).toBeInTheDocument();
    expect(artplayerMock.ArtPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://proxy.example/1.m3u8",
        type: "m3u8",
        autoplay: true,
        playsInline: true,
        playbackRate: true,
        customType: expect.objectContaining({ m3u8: expect.any(Function) }),
      }),
    );
    expect(artplayerMock.instances[0]?.on).toHaveBeenCalledWith("video:play", expect.any(Function));
    expect(screen.getByText("iKun资源")).toBeInTheDocument();
    expect(screen.getByText("HLS 直连")).toBeInTheDocument();
    expect(screen.queryByText("HLS 代理")).toBeNull();
    expect(screen.queryByText("已选集")).toBeNull();
    expect(screen.queryByText("待选择")).toBeNull();
    expect(screen.queryByText("可重试")).toBeNull();
    expect(screen.queryByText("播放地址已就绪")).toBeNull();
  });

  it("destroys ArtPlayer without removing the React-owned host when the URL changes", async () => {
    const { rerender } = render(<PlaybackPanel state={readyState} onPlaying={vi.fn()} onRetry={vi.fn()} />);
    await screen.findByLabelText("ArtPlayer 播放器");

    rerender(<PlaybackPanel state={{ ...readyState, url: "https://proxy.example/2.m3u8" }} onPlaying={vi.fn()} onRetry={vi.fn()} />);

    expect(artplayerMock.instances[0]?.destroy).toHaveBeenCalledWith(false);
  });

  // ArtPlayer defers customType by a macrotask — its url setter awaits sleep() before
  // calling the callback (artplayer.mjs urlMix) — so teardown can win the race and the
  // callback still runs against a destroyed player. The hls.js branch already exits on
  // the disposed flag after its dynamic import; the native branch reaches video.src
  // synchronously, and it is the branch iPhone WebKit takes.
  // ArtPlayer 会把 customType 推迟一个宏任务 — 其 url setter 在调用回调前
  // await sleep() (artplayer.mjs 的 urlMix) — 因此拆卸可能先完成,
  // 而回调仍会对已销毁的播放器执行. hls.js 分支在动态 import 之后已有 disposed 检查;
  // native 分支则同步走到 video.src, 而它正是 iPhone WebKit 会走的分支.
  it("leaves the video untouched when the deferred type callback fires after teardown", async () => {
    const w = window as unknown as Record<string, unknown>;
    const originalMediaSource = Object.getOwnPropertyDescriptor(window, "MediaSource");
    const originalManaged = Object.getOwnPropertyDescriptor(window, "ManagedMediaSource");
    // The iPhone WebKit capability signature, which routes the callback to native playback.
    // iPhone WebKit 的能力特征, 会把回调导向原生播放.
    delete w.MediaSource;
    Object.defineProperty(window, "ManagedMediaSource", { value: function ManagedMediaSourceStub() {}, configurable: true, writable: true });

    try {
      const index = artplayerMock.instances.length;
      const { unmount } = render(<PlaybackPanel state={readyState} onPlaying={vi.fn()} onRetry={vi.fn()} />);
      await screen.findByLabelText("ArtPlayer 播放器");

      const customType = artplayerMock.instances[index]?.option.customType as { m3u8: (video: unknown, url: string) => Promise<void> };
      unmount();

      const video = { canPlayType: () => "maybe", src: "" };
      await customType.m3u8(video, "https://proxy.example/late.m3u8");

      expect(video.src).toBe("");
    } finally {
      if (originalMediaSource) Object.defineProperty(window, "MediaSource", originalMediaSource);
      if (originalManaged) {
        Object.defineProperty(window, "ManagedMediaSource", originalManaged);
      } else {
        delete w.ManagedMediaSource;
      }
    }
  });
});
