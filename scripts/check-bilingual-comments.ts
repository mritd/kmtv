#!/usr/bin/env tsx
// check-bilingual-comments scans configured TypeScript roots and reports exported
// functions whose adjacent documentation does not contain English and Chinese prose.
//
// check-bilingual-comments 扫描指定的 TypeScript root, 报告相邻文档未同时包含英文和中文的导出函数.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// CLI accepts repeatable --root <relative-path> arguments. With no argument it
// scans web/src to preserve the original Web-only behavior.
//
// CLI 接受可重复的 --root <relative-path> 参数. 未传参数时扫描 web/src,
// 保留原有仅检查 Web 的行为.
function parseRoots(argv: string[]): string[] {
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root" && i + 1 < argv.length) {
      roots.push(argv[i + 1]);
      i += 1;
    }
  }
  return roots.length > 0 ? roots : ["web/src"];
}

const REPO_ROOT = resolve(__dirname, "..");
const ROOTS = parseRoots(process.argv.slice(2)).map((p) => resolve(REPO_ROOT, p));
const EXCLUDE_DIRS = new Set(["__tests__", "test"]);
const EXCLUDE_SUFFIX = [".test.ts", ".test.tsx", ".d.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      walk(full, out);
    } else if (st.isFile()) {
      if (EXCLUDE_SUFFIX.some((s) => full.endsWith(s))) continue;
      if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
    }
  }
  return out;
}

// CJK matches the common Han range used by this advisory checker.
//
// CJK 匹配该提示性 checker 使用的常见汉字区间.
const CJK = /[一-鿿]/;

// stripCommentMarkers removes leading `*`, `//`, `/**`, `*/` decorations so the bilingual
// pattern can match across multi-line JSDoc blocks regardless of indent style.
//
// stripCommentMarkers 去除 `*`, `//`, `/**`, `*/` 等注释装饰, 使双语模式不受
// 多行 JSDoc 缩进风格影响.
function stripCommentMarkers(text: string): string {
  return text
    .replace(/\/\*\*?/g, " ")
    .replace(/\*\//g, " ")
    .replace(/^\s*\*\s?/gm, "")
    .replace(/^\s*\/\/\s?/gm, "");
}

// hasBilingualPattern checks for at least one period followed by CJK characters followed by
// another period anywhere in the normalised comment text.
//
// hasBilingualPattern 检查归一化注释中是否存在 "period + 汉字 + period" 模式.
function hasBilingualPattern(text: string): boolean {
  const normalised = stripCommentMarkers(text).replace(/\s+/g, " ");
  return /\.\s+[^.]*[一-鿿]+[^.]*\./.test(normalised);
}

interface Finding {
  file: string;
  line: number;
  message: string;
}

// gatherPrecedingComment walks upwards from the export line, collecting any contiguous
// `//` line comments or one `/** ... */` JSDoc block. It tolerates one raw blank line
// between documentation and export; two or more blank lines break the association.
//
// gatherPrecedingComment 从 export 向上收集连续 `//` 注释或单个 `/** ... */` JSDoc 块.
// 文档与 export 之间允许一个原始空行, 两个及以上空行则视为不相邻.
function gatherPrecedingComment(lines: string[], exportIdx: number): string {
  const collected: string[] = [];
  let i = exportIdx - 1;
  // Tolerate one raw blank line between documentation and export.
  //
  // 文档与 export 之间允许一个原始空行.
  if (i >= 0 && /^\s*$/.test(lines[i])) {
    i -= 1;
  }
  if (i < 0) return "";

  if (/\*\//.test(lines[i])) {
    // Walk back to the matching /** start of a JSDoc block.
    //
    // 向上找到匹配的 /** 起始.
    while (i >= 0) {
      collected.unshift(lines[i]);
      if (/\/\*\*/.test(lines[i])) break;
      i -= 1;
    }
    return collected.join("\n");
  }

  if (/^\s*\/\//.test(lines[i])) {
    while (i >= 0 && /^\s*\/\//.test(lines[i])) {
      collected.unshift(lines[i]);
      i -= 1;
    }
    return collected.join("\n");
  }

  return "";
}

function findExports(filePath: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  // Pattern matches `export function foo(`, `export async function foo(`, `export const foo = (`, `export function* foo(`.
  //
  // 匹配各种导出函数声明.
  const pattern = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)|^\s*export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = pattern.exec(line);
    if (!match) continue;
    const name = match[1] ?? match[2];
    // Look at the preceding comment block (line or JSDoc) plus the current line for any inline trailing comment.
    //
    // 检查前面的注释块 (行注释或 JSDoc) 加上当前行末尾的内联注释.
    const preceding = gatherPrecedingComment(lines, i);
    const combined = `${preceding}\n${line}`;
    if (!CJK.test(combined)) {
      findings.push({ file: filePath, line: i + 1, message: `missing bilingual comment on export \`${name}\`` });
    } else if (!hasBilingualPattern(combined)) {
      findings.push({
        file: filePath,
        line: i + 1,
        message: `comment for export \`${name}\` does not match the bilingual pattern (English. 中文.)`,
      });
    }
  }
  return findings;
}

const allFiles: string[] = [];
for (const root of ROOTS) {
  allFiles.push(...walk(root));
}
const findings: Finding[] = [];
for (const file of allFiles) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  findings.push(...findExports(file, lines));
}

if (findings.length === 0) {
  console.log("bilingual comments OK");
  process.exit(0);
}

// Advisory mode:
// print findings to stderr but exit 0 so CI can adopt this gradually.
//
// 提示模式: 仅向 stderr 输出问题并返回 0, 使 CI 可以逐步接入该检查.
for (const f of findings) {
  const rel = relative(resolve(__dirname, ".."), f.file);
  console.error(`${rel}:${f.line}: ${f.message}`);
}
console.error(`\n${findings.length} positions missing bilingual comments (advisory)`);
process.exit(0);
