#!/usr/bin/env tsx
// check-bilingual-comments scans web/src/**/*.{ts,tsx} for exported functions whose preceding or trailing comment lacks the bilingual "English.
// 中文." pattern.
// check-bilingual-comments
// 扫描 web/src 下的 TypeScript 文件, 报告导出函数缺少 "English. 中文." 双语注释的位置.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// CLI: --root <relative-path> (repeatable). Defaults to web/src for backward compatibility.
// CLI: --root <相对路径> (可重复). 缺省值 web/src, 保持向后兼容.
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

// CJK range covers common Chinese characters.
// CJK
// 范围覆盖常见中文.
const CJK = /[一-鿿]/;

// stripCommentMarkers removes leading `*`, `//`, `/**`, `*/` decorations so the bilingual
// pattern can match across multi-line JSDoc blocks regardless of indent style.
// stripCommentMarkers 去除注释装饰字符 (* / //), 让双语模式匹配可跨多行 JSDoc 块.
function stripCommentMarkers(text: string): string {
  return text
    .replace(/\/\*\*?/g, " ")
    .replace(/\*\//g, " ")
    .replace(/^\s*\*\s?/gm, "")
    .replace(/^\s*\/\/\s?/gm, "");
}

// hasBilingualPattern checks for at least one period followed by CJK characters followed by
// another period anywhere in the normalised comment text.
// hasBilingualPattern
// 检查归一化后的注释文本中至少存在一处 "句号 + 中文 + 句号" 模式.
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
// `//` line comments OR a single `/** ... */` JSDoc block immediately above. Blank lines
// between the comment and the export break the association.
// gatherPrecedingComment 向上收集紧邻 export 的注释:
// 既支持连续的 `//` 行注释, 也支持单个 `/** ... */` JSDoc 块. 中间出现空行视为不相邻.
function gatherPrecedingComment(lines: string[], exportIdx: number): string {
  const collected: string[] = [];
  let i = exportIdx - 1;
  // Skip blank lines that could legitimately sit between comment and export; tolerate one.
  // 容忍 export 与注释间的一行空行, 多行空行视为不相邻.
  if (i >= 0 && /^\s*$/.test(lines[i])) {
    i -= 1;
  }
  if (i < 0) return "";

  if (/\*\//.test(lines[i])) {
    // Walk back to the matching /** start of a JSDoc block.
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
  // 匹配各种导出函数声明.
  const pattern = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)|^\s*export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = pattern.exec(line);
    if (!match) continue;
    const name = match[1] ?? match[2];
    // Look at the preceding comment block (line or JSDoc) plus the current line for any inline trailing comment.
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
// 顾问模式: 仅打印至 stderr 不阻断, 待全量整改后切换为 exit 1.
for (const f of findings) {
  const rel = relative(resolve(__dirname, ".."), f.file);
  console.error(`${rel}:${f.line}: ${f.message}`);
}
console.error(`\n${findings.length} positions missing bilingual comments (advisory)`);
process.exit(0);
