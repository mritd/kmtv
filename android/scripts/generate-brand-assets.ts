#!/usr/bin/env tsx
// Idempotent brand asset generator: renders SVGs in assets/brand/*.svg
// into 1024x1024 PNGs at assets/{icon,adaptive-icon,splash}.png via rsvg-convert.
// Validates output dimensions + file size so a silent rsvg failure cannot ship a blank PNG.
// 幂等的品牌资源生成器: 将 assets/brand/*.svg 用 rsvg-convert 渲染为 1024x1024 PNG, 写入 assets/.
// 同时校验尺寸与文件大小, 防止 rsvg 静默失败时落下空白 PNG.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";

const SIZE = 1024;
const MIN_BYTES = 1024;
const ROOT = resolve(__dirname, "..");
const ASSETS = join(ROOT, "assets");

const targets: Array<{ src: string; out: string }> = [
  { src: "brand/icon.svg", out: "icon.png" },
  { src: "brand/adaptive-icon.svg", out: "adaptive-icon.png" },
  { src: "brand/splash.svg", out: "splash.png" },
];

for (const t of targets) {
  const srcPath = join(ASSETS, t.src);
  const outPath = join(ASSETS, t.out);
  execFileSync(
    "rsvg-convert",
    ["-w", String(SIZE), "-h", String(SIZE), "-o", outPath, srcPath],
    { stdio: "inherit" },
  );
  const { size } = statSync(outPath);
  if (size < MIN_BYTES) {
    throw new Error(`generated ${t.out} is only ${size} bytes; rsvg-convert likely failed silently`);
  }
  const probe = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", outPath], { encoding: "utf8" });
  const width = Number(probe.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(probe.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (width !== SIZE || height !== SIZE) {
    throw new Error(`generated ${t.out} is ${width}x${height}, expected ${SIZE}x${SIZE}`);
  }
  console.log(`ok ${t.out} (${size} bytes, ${width}x${height})`);
}
