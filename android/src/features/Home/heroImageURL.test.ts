// heroImageURL mirrors HomeView.swift heroImageURL(_:).
// heroImageURL 与 HomeView.swift 中 heroImageURL(_:) 保持一致.

import { heroImageURL } from "./heroImageURL";

describe("heroImageURL", () => {
  it("returns null for empty cover", () => expect(heroImageURL("https://x", "")).toBeNull());
  it("joins relative paths to baseURL", () =>
    expect(heroImageURL("https://x", "/img/a.jpg")).toBe("https://x/img/a.jpg"));
  it("passes absolute URLs through", () =>
    expect(heroImageURL("https://x", "https://other/a.jpg")).toBe("https://other/a.jpg"));
  it("returns the cover as-is when it has no scheme and no leading slash", () =>
    expect(heroImageURL("https://x", "raw.jpg")).toBe("raw.jpg"));
});
