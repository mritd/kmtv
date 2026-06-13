// settingsSchema unit tests — covers URL validator, clamp, and diff.
// settingsSchema 单元测试, 覆盖 URL 校验、clamp 与 diff.

import { clampNumber, diffSettings, editableSettingsSchema, validatePublicBaseURL } from "./settingsSchema";

describe("editableSettingsSchema", () => {
  test("clamp ranges match server settings.go", () => {
    const lookup = Object.fromEntries(editableSettingsSchema.map((e) => [e.key, e]));
    expect(lookup.search_concurrency).toMatchObject({ min: 1, max: 50 });
    expect(lookup.probe_concurrency).toMatchObject({ min: 1, max: 50 });
    expect(lookup.probe_timeout).toMatchObject({ min: 1, max: 20 });
    expect(lookup.search_timeout).toMatchObject({ min: 1, max: 30 });
  });
});

describe("validatePublicBaseURL", () => {
  test("empty is valid", () => { expect(validatePublicBaseURL("")).toBeUndefined(); });
  test("https without query is valid", () => { expect(validatePublicBaseURL("https://a.b")).toBeUndefined(); });
  test("nonsense returns invalid", () => { expect(validatePublicBaseURL("not a url")).toBe("invalid"); });
  test("ftp returns scheme", () => { expect(validatePublicBaseURL("ftp://a.b")).toBe("scheme"); });
  test("query returns extra", () => { expect(validatePublicBaseURL("https://a.b/?x=1")).toBe("extra"); });
  test("fragment returns extra", () => { expect(validatePublicBaseURL("https://a.b/#x")).toBe("extra"); });
});

describe("clampNumber", () => {
  test("clamps below min", () => { expect(clampNumber(0, 1, 50)).toBe(1); });
  test("clamps above max", () => { expect(clampNumber(99, 1, 50)).toBe(50); });
  test("passes through inside range", () => { expect(clampNumber(7, 1, 50)).toBe(7); });
  test("undefined bounds pass through", () => { expect(clampNumber(7)).toBe(7); });
});

describe("diffSettings", () => {
  test("returns only changed keys", () => {
    expect(diffSettings({ a: "1", b: "2" }, { a: "1", b: "3" })).toEqual({ b: "3" });
  });
  test("empty diff", () => { expect(diffSettings({ a: "1" }, { a: "1" })).toEqual({}); });
  test("treats new key as change", () => { expect(diffSettings({}, { a: "1" })).toEqual({ a: "1" }); });
});
