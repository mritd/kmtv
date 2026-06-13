// PosterImage tests cover placeholder rendering and URL resolution.
// PosterImage 测试覆盖占位图渲染与 URL 解析.

import { render } from "@testing-library/react-native";
import React from "react";

import { PosterImage, resolvePosterURL } from "./PosterImage";

describe("resolvePosterURL", () => {
  it("returns null for empty cover", () => {
    expect(resolvePosterURL("https://x", "")).toBeNull();
  });

  it("joins relative cover paths to baseURL", () => {
    expect(resolvePosterURL("https://x", "/img/a.jpg")).toBe("https://x/img/a.jpg");
  });

  it("passes absolute URLs through", () => {
    expect(resolvePosterURL("https://x", "https://other/a.jpg")).toBe("https://other/a.jpg");
  });

  it("strips one trailing slash from baseURL before joining", () => {
    expect(resolvePosterURL("https://x/", "/img/a.jpg")).toBe("https://x/img/a.jpg");
  });
});

describe("PosterImage", () => {
  it("renders the placeholder (no <Image>) when cover is empty", () => {
    const { queryByTestId } = render(
      <PosterImage baseURL="https://x" cover="" testID="poster" />,
    );
    expect(queryByTestId("poster-placeholder")).not.toBeNull();
    expect(queryByTestId("poster")).toBeNull();
  });

  it("renders <Image> with the resolved source when cover is present", () => {
    const { getByTestId, queryByTestId } = render(
      <PosterImage baseURL="https://x" cover="/c.jpg" testID="poster" />,
    );
    expect(getByTestId("poster")).toBeTruthy();
    expect(queryByTestId("poster-placeholder")).toBeNull();
  });
});
