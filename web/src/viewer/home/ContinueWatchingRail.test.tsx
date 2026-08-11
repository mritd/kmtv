// ContinueWatchingRail tests — cover semantic rail rendering, clamped progress, selection, and guarded clearing.
//
// ContinueWatchingRail 测试 — 覆盖语义化 rail 渲染, 进度限制, 选择回调和受保护清空.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { WatchHistoryItem } from "@/api/types";

import { ContinueWatchingRail, type ContinueWatchingItem } from "./ContinueWatchingRail";

function makeHistoryItem(overrides: Partial<WatchHistoryItem> = {}): WatchHistoryItem {
  const index = overrides.id ?? 1;
  return {
    id: index,
    source_key: `source-${index}`,
    video_id: `video-${index}`,
    title: `Demo Show ${index}`,
    cover: "",
    episode: `Episode ${index}`,
    group_index: 0,
    episode_index: index - 1,
    progress_sec: 120,
    duration_sec: 600,
    completed: false,
    event_time_ms: 1_808_000_000_000 + index,
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z",
    ...overrides,
  };
}

describe("ContinueWatchingRail", () => {
  it("renders at most ten semantic history cards with localized progress", () => {
    const items = Array.from({ length: 12 }, (_, index) => makeHistoryItem({ id: index + 1 }));

    render(<ContinueWatchingRail items={items} onSelect={vi.fn()} onClear={vi.fn()} isClearing={false} />);

    const section = screen.getByRole("region", { name: "继续观看" });
    expect(within(section).getByRole("heading", { name: "继续观看" })).toBeInTheDocument();
    expect(within(section).getByText("10 条记录")).toBeInTheDocument();

    const rail = within(section).getByRole("list", { name: "继续观看" });
    expect(within(rail).getAllByRole("listitem")).toHaveLength(10);
    expect(within(rail).getByRole("button", { name: /Demo Show 10/ })).toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: /Demo Show 11/ })).toBeNull();

    const firstCard = within(rail).getByRole("button", { name: "Demo Show 1, Episode 1" });
    expect(within(firstCard).getByText("Episode 1")).toHaveClass("continue-meta-episode");
    expect(within(firstCard).queryByText("已观看 20%")).not.toBeInTheDocument();
  });

  it("clamps progress into the accessible 0 to 100 range", () => {
    render(
      <ContinueWatchingRail
        items={[
          makeHistoryItem({ id: 1, title: "Negative", progress_sec: -20, duration_sec: 100 }),
          makeHistoryItem({ id: 2, title: "Overflow", progress_sec: 180, duration_sec: 100 }),
          makeHistoryItem({ id: 3, title: "Missing Duration", progress_sec: 30, duration_sec: 0 }),
          makeHistoryItem({ id: 4, title: "Invalid Progress", progress_sec: Number.NaN, duration_sec: 100 }),
          makeHistoryItem({ id: 5, title: "Invalid Duration", progress_sec: 30, duration_sec: Number.NaN }),
        ]}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        isClearing={false}
      />,
    );

    expect(screen.getByRole("progressbar", { name: "Negative, Episode 1, 已观看 0%" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("progressbar", { name: "Overflow, Episode 2, 已观看 100%" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar", { name: "Missing Duration, Episode 3, 已观看 0%" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getByRole("progressbar", { name: "Invalid Progress, Episode 4, 已观看 0%" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getByRole("progressbar", { name: "Invalid Duration, Episode 5, 已观看 0%" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("selects the clicked card", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const item = makeHistoryItem({ title: "Pick Me" });

    render(<ContinueWatchingRail items={[item]} onSelect={onSelect} onClear={vi.fn()} isClearing={false} />);

    await user.click(screen.getByRole("button", { name: /Pick Me/ }));

    expect(onSelect).toHaveBeenCalledWith(item);
  });

  it("accepts anonymous local history cards with stable string IDs", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const item: ContinueWatchingItem = {
      id: "anonymous:pick me",
      title: "Pick Me",
      cover: "",
      episode: "01",
      progress_sec: 60,
      duration_sec: 120,
    };

    render(<ContinueWatchingRail items={[item]} onSelect={onSelect} onClear={vi.fn()} isClearing={false} />);

    await user.click(screen.getByRole("button", { name: "Pick Me, 01" }));

    expect(onSelect).toHaveBeenCalledWith(item);
  });

  it("guards clearing with a confirmation dialog and disables both actions while pending", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    const { rerender } = render(
      <ContinueWatchingRail items={[makeHistoryItem()]} onSelect={vi.fn()} onClear={onClear} isClearing={false} />,
    );

    await user.click(screen.getByRole("button", { name: "清空观看记录" }));
    expect(screen.getByRole("dialog", { name: "清空观看记录?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(onClear).toHaveBeenCalledTimes(1);

    rerender(<ContinueWatchingRail items={[makeHistoryItem()]} onSelect={vi.fn()} onClear={onClear} isClearing />);
    expect(screen.getByRole("button", { name: "正在清空" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });
});
