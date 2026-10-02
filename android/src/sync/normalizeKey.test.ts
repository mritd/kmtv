// normalizeKey tests — pin key normalization to the vectors shared with the Go server and Web.
//
// normalizeKey 测试 — 将 key 归一化固定到与 Go 服务端和 Web 共享的用例.

import { readFileSync } from "fs";
import { join } from "path";

import { normalizeSyncKey, trimSyncText } from "./normalizeKey";

const vectors = (
  JSON.parse(readFileSync(join(__dirname, "../../../testdata/sync-key-vectors.json"), "utf8")) as {
    vectors: Array<{ input: string; key: string }>;
  }
).vectors;

describe("normalizeSyncKey", () => {
  it("matches the shared server vectors", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(10);
    for (const vector of vectors) {
      expect(normalizeSyncKey(vector.input)).toBe(vector.key);
    }
  });

  it("trims only the edges for display text", () => {
    expect(trimSyncText("　 Demo  Show \n")).toBe("Demo  Show");
  });
});
