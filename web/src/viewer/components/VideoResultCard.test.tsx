import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SearchResult } from "@/api/types";

import { VideoResultCard } from "./VideoResultCard";

const item: SearchResult = {
  title: "Slam Dunk",
  type: "Anime",
  year: "1993",
  desc: "Basketball story",
  cover: "https://img.example/poster.jpg",
  sources: [
    { source_key: "a", source_name: "Source A", video_id: "1", duration_ms: 412 },
    { source_key: "b", source_name: "Source B", video_id: "2", duration_ms: 1200 },
  ],
};

describe("VideoResultCard", () => {
  it("shows source count and opens the default source", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<VideoResultCard item={item} onOpen={onOpen} onFavorite={vi.fn()} isFavorited={false} />);

    expect(screen.getByText("2 个来源")).toBeInTheDocument();
    expect(screen.getByText("最快 412ms")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "播放 Slam Dunk" }));
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it("disables playback when no source exists", () => {
    render(<VideoResultCard item={{ ...item, sources: [] }} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "暂无来源" })).toBeDisabled();
  });

  it("shows a destructive remove-favorite action when the result is already saved", () => {
    render(<VideoResultCard item={item} onOpen={vi.fn()} onFavorite={vi.fn()} isFavorited />);

    expect(screen.getByRole("button", { name: "取消收藏" })).toHaveClass("ui-button-danger");
    expect(screen.queryByRole("button", { name: "已收藏" })).toBeNull();
    expect(screen.queryByRole("button", { name: "收藏" })).toBeNull();
  });

  it("treats null source lists as empty instead of crashing", () => {
    // Source APIs are untrusted at runtime, even when TypeScript models require arrays.
    // 来源 API 在运行时不可信, 即使 TypeScript 模型要求数组.
    const unsafeItem = { ...item, cover: "", sources: null } as unknown as SearchResult;

    render(<VideoResultCard item={unsafeItem} onOpen={vi.fn()} onFavorite={vi.fn()} />);

    expect(screen.getByRole("button", { name: "暂无来源" })).toBeDisabled();
    expect(screen.getByText("KMTV")).toBeInTheDocument();
  });
});
