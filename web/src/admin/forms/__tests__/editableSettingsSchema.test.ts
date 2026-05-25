import { describe, expect, it } from "vitest";

import { editableSettingsSchema, validatePublicBaseURL } from "../editableSettingsSchema";

describe("validatePublicBaseURL", () => {
  it("accepts empty values", () => {
    expect(validatePublicBaseURL("")).toBeUndefined();
    expect(validatePublicBaseURL("   ")).toBeUndefined();
  });

  it("accepts valid http and https URLs", () => {
    expect(validatePublicBaseURL("https://example.com")).toBeUndefined();
    expect(validatePublicBaseURL("http://example.com")).toBeUndefined();
    expect(validatePublicBaseURL("https://example.com/path")).toBeUndefined();
  });

  it("rejects malformed URLs", () => {
    expect(validatePublicBaseURL("not a url")).toBe("invalid");
  });

  it("rejects non-http(s) schemes", () => {
    expect(validatePublicBaseURL("ftp://example.com")).toBe("scheme");
  });

  it("rejects URLs with query or hash", () => {
    expect(validatePublicBaseURL("https://example.com?x=1")).toBe("extra");
    expect(validatePublicBaseURL("https://example.com#frag")).toBe("extra");
  });
});

describe("editableSettingsSchema", () => {
  it("declares every entry with a distinct key", () => {
    const keys = editableSettingsSchema.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
