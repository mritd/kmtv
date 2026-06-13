// Snapshot-style guard for app.config.ts: catches accidental drift on the brand surface.
// app.config.ts 的快照式守护: 拦截品牌字段的误改.

import appConfig from "../../app.config";

describe("app.config.ts brand surface", () => {
  it("declares the M8 version + Android package + versionCode", () => {
    expect(appConfig.version).toBe("0.2.0");
    expect(appConfig.android?.package).toBe("com.mritd.kmtv");
    expect(appConfig.android?.versionCode).toBe(1);
  });

  it("declares the adaptive icon foreground + brand background color", () => {
    expect(appConfig.android?.adaptiveIcon?.foregroundImage).toBe("./assets/adaptive-icon.png");
    expect(appConfig.android?.adaptiveIcon?.backgroundColor).toBe("#4A8AF5");
  });

  it("registers expo-splash-screen with the brand background + contain mode + explicit imageWidth", () => {
    const splash = (appConfig.plugins ?? []).find(
      (p): p is [string, Record<string, unknown>] =>
        Array.isArray(p) && p[0] === "expo-splash-screen",
    );
    expect(splash).toBeDefined();
    const opts = splash?.[1];
    expect(opts?.backgroundColor).toBe("#4A8AF5");
    expect(opts?.image).toBe("./assets/splash.png");
    expect(opts?.resizeMode).toBe("contain");
    expect(opts?.imageWidth).toBe(360);
  });
});
