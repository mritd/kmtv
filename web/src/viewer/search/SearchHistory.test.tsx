/**
 * SearchHistory tests cover chip rendering, selection, clearing, and the empty state.
 *
 * SearchHistory 测试覆盖标签渲染, 选择, 清空以及空状态.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchHistory } from "./SearchHistory";

describe("SearchHistory", () => {
  it("renders nothing without items", () => {
    const { container } = render(<SearchHistory items={[]} onSelect={vi.fn()} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("selects a query and clears the history", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClear = vi.fn();
    render(<SearchHistory items={["Alpha", "Beta"]} onSelect={onSelect} onClear={onClear} />);
    expect(screen.getByRole("region", { name: "最近搜索" })).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute("title", "Beta");
    await user.click(screen.getByRole("button", { name: "Beta" }));
    expect(onSelect).toHaveBeenCalledWith("Beta");
    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
