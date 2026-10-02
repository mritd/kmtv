/**
 * normalizeKey tests pin key normalization to the vectors shared with the Go server.
 *
 * normalizeKey 测试将 key 归一化固定到与 Go 服务端共享的用例.
 */
// @ts-expect-error Vitest runs this file in Node, while the app tsconfig stays browser-only.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeSyncKey, trimSyncText } from "./normalizeKey";

const vectors = (
  JSON.parse(readFileSync("../testdata/sync-key-vectors.json", "utf8")) as {
    vectors: Array<{ input: string; key: string }>;
  }
).vectors;

describe("normalizeSyncKey", () => {
  it("matches the shared server vectors", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(10);
    for (const vector of vectors) {
      expect(normalizeSyncKey(vector.input), JSON.stringify(vector.input)).toBe(vector.key);
    }
  });

  it("trims only the edges for display text", () => {
    expect(trimSyncText("　 Demo  Show \n")).toBe("Demo  Show");
  });
});
