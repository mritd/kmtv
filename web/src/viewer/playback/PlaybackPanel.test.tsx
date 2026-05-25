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
});
