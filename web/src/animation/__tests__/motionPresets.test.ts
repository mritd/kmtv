import { describe, expect, it } from "vitest";

import { reducedMotionTransition, staggerChild, staggerParent, transitions } from "../motionPresets";

describe("motionPresets", () => {
  it("exposes three named transition presets with non-zero durations", () => {
    expect(transitions.fastFade.duration).toBeGreaterThan(0);
    expect(transitions.pageSlide.duration).toBeGreaterThan(0);
    expect(transitions.modalPop.duration).toBeGreaterThan(0);
  });

  it("reducedMotionTransition collapses to zero duration", () => {
    expect(reducedMotionTransition.duration).toBe(0);
  });

  it("stagger variants define hidden and visible states", () => {
    expect(staggerParent.hidden).toEqual({});
    expect(staggerParent.visible).toMatchObject({ transition: { staggerChildren: 0.04 } });
    expect(staggerChild.hidden).toEqual({ opacity: 0, y: 8 });
    expect(staggerChild.visible).toEqual({ opacity: 1, y: 0 });
  });
});
