// Compile-only sanity check that the home discovery type shapes match the iOS contract.
// 编译期校验首页发现类型与 iOS 契约一致.

import type { DoubanHomeResponse, DoubanItem, HomeSection } from "./types";

describe("DoubanHomeResponse types", () => {
  it("HomeSection items use DoubanItem shape", () => {
    const item: DoubanItem = { id: "i1", title: "t", cover: "/c.jpg", rate: "8.4", year: "2024" };
    const section: HomeSection = { name: "热门", tag: "hot", type: "movie", items: [item] };
    const resp: DoubanHomeResponse = { sections: [section] };
    expect(resp.sections[0]!.items[0]!.rate).toBe("8.4");
  });
});
