// Tests for the URL validation helper used by ServerSetup.
// ServerSetup 使用的 URL 校验 helper 的测试.

import { isValidHTTPURL } from "./urlValidation";

describe("isValidHTTPURL", () => {
  it.each([
    ["https://kmtv.example.com", true],
    ["http://10.0.0.5:8080", true],
    ["HTTP://example.com", true],
    ["https://example.com/api", true],
    ["http://localhost:8080", true],
    ["https://example.com/api?foo=bar", true],
    ["https://example.com/api#section", true],
    ["  https://example.com  ", true],
    ["ftp://example.com", false],
    ["example.com", false],
    ["https://", false],
    ["", false],
    ["   ", false],
    ["not a url", false],
  ])("returns %p for %s", (input, expected) => {
    expect(isValidHTTPURL(input as string)).toBe(expected);
  });
});
