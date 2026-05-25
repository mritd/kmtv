import { describe, expect, it } from "vitest";

import { decodeDetailToken, detailRoutePath, encodeDetailToken } from "./detailRoute";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_RE = new RegExp(`^[${BASE58_ALPHABET}]+$`);

describe("encodeDetailToken / decodeDetailToken", () => {
  it.each([
    ["ascii", "www.subozy.com", "110661"],
    ["short", "wo", "1"],
    ["unicode_source", "源-中文", "id-9527"],
    ["unicode_id", "source-a", "标题-2026"],
    ["punctuation", "source.key/with+chars", "video?id=42&x=1"],
    ["long", "a".repeat(120), "b".repeat(120)],
  ])("round-trips %s", (_label, sourceKey, videoId) => {
    const token = encodeDetailToken(sourceKey, videoId);
    expect(token).toMatch(BASE58_RE);
    expect(decodeDetailToken(token)).toEqual({ sourceKey, videoId });
  });

  it("produces stable output for the same input", () => {
    expect(encodeDetailToken("source-a", "video-1")).toBe(encodeDetailToken("source-a", "video-1"));
  });

  it("produces different tokens for different inputs", () => {
    expect(encodeDetailToken("source-a", "video-1")).not.toBe(encodeDetailToken("source-a", "video-2"));
    expect(encodeDetailToken("source-a", "video-1")).not.toBe(encodeDetailToken("source-b", "video-1"));
  });

  it("hides third-party source domains from the visible URL", () => {
    const path = detailRoutePath("www.subozy.com", "110661");
    expect(path.startsWith("/detail/")).toBe(true);
    expect(path).not.toContain("subozy");
    expect(path).not.toContain("/110661");
  });

  it.each([
    ["empty sourceKey", "", "video-1"],
    ["empty videoId", "source-a", ""],
    ["sourceKey with separator", "bad\x1Fsource", "video-1"],
    ["videoId with separator", "source-a", "bad\x1Fvideo"],
  ])("refuses to encode invalid input: %s", (_label, sourceKey, videoId) => {
    expect(() => encodeDetailToken(sourceKey, videoId)).toThrow(/refusing to encode/);
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["invalid char (0)", "0aaaaa"],
    ["invalid char (O)", "OaaaaaO"],
    ["invalid char (I)", "IaaaaaI"],
    ["invalid char (l)", "laaaaal"],
    ["invalid char (-)", "abc-def"],
    ["no separator", base58EncodeRaw("plain-payload-no-sep")],
    ["leading separator", base58EncodeRaw("\x1Fvideo-1")],
    ["trailing separator", base58EncodeRaw("source-a\x1F")],
    ["double separator", base58EncodeRaw("source\x1Fvideo\x1Fextra")],
  ])("rejects malformed token: %s", (_label, token) => {
    expect(decodeDetailToken(token as string | null | undefined)).toBeNull();
  });
});

// base58EncodeRaw mirrors the internal base58 encoder so tests can construct
// well-formed envelopes that wrap deliberately-malformed payloads.
// base58EncodeRaw 复刻内部 base58 编码, 让测试可以构造包裹故意非法负载的合法外层.
function base58EncodeRaw(rawPayload: string): string {
  const bytes = new TextEncoder().encode(rawPayload);
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1;
  }
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value = value / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  return BASE58_ALPHABET[0].repeat(leadingZeros) + encoded;
}
