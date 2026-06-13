// Theme token regression tests — guard against accidental palette drift from the iOS source of truth.
// 主题 token 回归测试, 防止视觉与 iOS 真值漂移.

import { darkColors, lightColors, sizes } from "./theme";

describe("theme tokens", () => {
  it("light palette mirrors iOS Theme.swift", () => {
    expect(lightColors.bgPrimary).toBe("rgb(245, 245, 247)");
    expect(lightColors.bgSecondary).toBe("rgb(235, 235, 239)");
    expect(lightColors.bgCard).toBe("rgb(255, 255, 255)");
    expect(lightColors.accent).toBe("rgb(74, 138, 245)");
    expect(lightColors.textPrimary).toBe("rgb(28, 28, 30)");
    expect(lightColors.textSecondary).toBe("rgb(107, 107, 111)");
    expect(lightColors.ratingBadgeBg).toBe("rgba(0, 0, 0, 0.7)");
  });

  it("dark palette mirrors iOS Theme.swift", () => {
    expect(darkColors.bgPrimary).toBe("rgb(10, 10, 10)");
    expect(darkColors.bgSecondary).toBe("rgb(20, 20, 24)");
    expect(darkColors.bgCard).toBe("rgb(30, 30, 38)");
    expect(darkColors.accent).toBe("rgb(108, 159, 255)");
    expect(darkColors.textPrimary).toBe("rgb(232, 232, 240)");
    expect(darkColors.textSecondary).toBe("rgb(136, 136, 136)");
  });

  it("size tokens match the spec", () => {
    expect(sizes.cardWidth).toBe(110);
    expect(sizes.heroHeight).toBe(240);
    expect(sizes.heroHeightTablet).toBe(320);
    expect(sizes.radius).toEqual({ sm: 4, md: 6, lg: 8, xl: 12, hero: 16 });
  });
});
