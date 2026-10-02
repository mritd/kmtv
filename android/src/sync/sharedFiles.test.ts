// sharedFiles tests — the platform-neutral sync modules must stay byte-identical to web/src/sync/.
//
// sharedFiles 测试 — 平台无关的同步模块必须与 web/src/sync/ 逐字节一致.

import { readFileSync } from "fs";
import { join } from "path";

const SHARED_FILES = [
  "types.ts",
  "normalizeKey.ts",
  "kinds.ts",
  "syncClock.ts",
  "syncMerge.ts",
  "syncStore.ts",
  "syncEngine.ts",
  "useWatchResume.ts",
];

const WEB_SYNC_DIR = join(__dirname, "../../../web/src/sync");

describe("shared sync files", () => {
  it.each(SHARED_FILES)("%s matches web/src/sync", (name) => {
    const android = readFileSync(join(__dirname, name), "utf8");
    const web = readFileSync(join(WEB_SYNC_DIR, name), "utf8");
    expect(android).toBe(web);
  });
});
