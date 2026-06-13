// Tests for the layout-width helpers used by every responsive screen.
// 各响应式页面共用的布局宽度辅助函数测试.

import {
  LARGE_TABLET_MIN_DP,
  PHONE_MAX_DP,
  TABLET_MIN_DP,
  pickLayoutWidth,
  pickNumColumns,
} from "./breakpoints";

describe("breakpoints", () => {
  it("exposes spec section 4 thresholds", () => {
    expect(PHONE_MAX_DP).toBe(599);
    expect(TABLET_MIN_DP).toBe(600);
    expect(LARGE_TABLET_MIN_DP).toBe(840);
  });

  it("classifies width into phone / tablet / largeTablet", () => {
    expect(pickLayoutWidth(0)).toBe("phone");
    expect(pickLayoutWidth(599)).toBe("phone");
    expect(pickLayoutWidth(600)).toBe("tablet");
    expect(pickLayoutWidth(839)).toBe("tablet");
    expect(pickLayoutWidth(840)).toBe("largeTablet");
    expect(pickLayoutWidth(1280)).toBe("largeTablet");
  });
});

describe("pickNumColumns", () => {
  it("3 cols < 600 dp", () => {
    expect(pickNumColumns(0)).toBe(3);
    expect(pickNumColumns(599)).toBe(3);
  });

  it("4 cols in [600, 840)", () => {
    expect(pickNumColumns(600)).toBe(4);
    expect(pickNumColumns(839)).toBe(4);
  });

  it("5 cols >= 840 dp", () => {
    expect(pickNumColumns(840)).toBe(5);
    expect(pickNumColumns(1280)).toBe(5);
  });
});
