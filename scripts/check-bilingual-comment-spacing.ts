#!/usr/bin/env bun
// check-bilingual-comment-spacing validates the repository bilingual comment boundary.
//
// check-bilingual-comment-spacing 校验仓库双语注释的语言分界格式.

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".go", ".ts", ".tsx", ".js", ".swift", ".sh"]);
const HAN_PATTERN = /\p{Script=Han}/u;
const DIRECTIVE_PATTERN = /^(?:go:|@ts-|eslint(?:-|\b)|biome(?:-|\b)|istanbul(?:\s|$)|c8(?:\s|$)|coverage(?:\s|$)|v8\s+ignore|prettier-|swiftlint:|shellcheck\b|nolint\b|nosec\b|<reference\b|<amd-(?:module|dependency)\b)/i;

const EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", ".build", "DerivedData", ".git"]);

export type FindingKind =
  | "missing-separator"
  | "extra-separator"
  | "mismatched-separator"
  | "reversed-order"
  | "ambiguous-boundary";

export interface Finding {
  file: string;
  line: number;
  kind: FindingKind;
  message: string;
}

export interface PlannedInsertion {
  beforeOffset: number;
  line: number;
  text: string;
}

export interface Analysis {
  findings: Finding[];
  insertions: PlannedInsertion[];
}

type Language = "han" | "mixed" | "non-han";
type CommentStyle = "line" | "block";

interface SourceLine {
  text: string;
  ending: string;
  offset: number;
  number: number;
}

interface CommentLine {
  source: SourceLine;
  content: string;
  marker: string;
  blankText: string | null;
  directive: boolean;
}

interface CommentRun {
  style: CommentStyle;
  lines: CommentLine[];
}

interface ClassifiedLine {
  comment: CommentLine;
  language: Language | null;
}

type OpaqueRegion =
  | { kind: "backtick" }
  | { kind: "swift-triple-string" }
  | { kind: "inline-block-comment" }
  | { kind: "shell-heredoc"; delimiter: string };

function normalizePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

/**
 * Returns whether a repository-relative path belongs to the authored source scan.
 *
 * 判断仓库相对路径是否属于需扫描的手写源码.
 */
export function isIncludedSourcePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (normalized === ".." || normalized.startsWith("../") || isAbsolute(normalized)) return false;
  const segments = normalized.split("/");

  if (!SOURCE_EXTENSIONS.has(extname(normalized))) return false;
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  if (segments.some((segment) => segment.endsWith(".xcodeproj") || segment.endsWith(".xcworkspace"))) {
    return false;
  }
  if (normalized.startsWith("web/src/i18n/locales/")) return false;
  if (normalized.startsWith("android/src/i18n/locales/")) return false;
  return true;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let offset = 0;
  let number = 1;

  while (offset < source.length) {
    const match = /\r\n|\n|\r/g.exec(source.slice(offset));
    if (!match) {
      lines.push({ text: source.slice(offset), ending: "", offset, number });
      return lines;
    }

    const endingOffset = offset + match.index;
    lines.push({
      text: source.slice(offset, endingOffset),
      ending: match[0],
      offset,
      number,
    });
    offset = endingOffset + match[0].length;
    number += 1;
  }

  return lines;
}

function isDirective(content: string): boolean {
  return DIRECTIVE_PATTERN.test(content.trim());
}

function lineComment(line: SourceLine, allowShellHash: boolean): CommentLine | null {
  if (line.number === 1 && /^\s*#!/.test(line.text)) return null;

  const slash = /^(\s*)(\/\/\/|\/\/)(.*)$/.exec(line.text);
  if (slash) {
    const [, indent, marker, rawContent] = slash;
    const content = rawContent.replace(/^\s?/, "");
    return {
      source: line,
      content,
      marker,
      blankText: `${indent}${marker}`,
      directive: isDirective(content),
    };
  }

  const shell = allowShellHash ? /^(\s*)(#)(.*)$/.exec(line.text) : null;
  if (shell) {
    const [, indent, marker, rawContent] = shell;
    const content = rawContent.replace(/^\s?/, "");
    return {
      source: line,
      content,
      marker,
      blankText: `${indent}${marker}`,
      directive: isDirective(content),
    };
  }

  return null;
}

function blockInnerLine(line: SourceLine, isOpening: boolean): CommentLine {
  let text = line.text;
  let marker = "*";

  const rawCloseIndex = isOpening ? -1 : text.indexOf("*/");
  const rawContentBeforeClose =
    rawCloseIndex >= 0 ? text.slice(0, rawCloseIndex).replace(/^\s*\*?/, "").trim() : null;
  if (rawContentBeforeClose === "") {
    const closePrefix = /^(\s*)(\*)?/.exec(line.text);
    return {
      source: line,
      content: "",
      marker: "*",
      blankText: closePrefix?.[2] ? `${closePrefix[1]}*` : "",
      directive: false,
    };
  }

  if (isOpening) {
    const opening = /^(\s*\{?)(\/\*\*?)(.*)$/.exec(text);
    if (!opening) throw new Error(`internal parser error at line ${line.number}`);
    const [, , openingMarker, remainder] = opening;
    marker = openingMarker;
    text = remainder;
  } else {
    const inner = /^(\s*)(\*)?(.*)$/.exec(text);
    if (!inner) throw new Error(`internal parser error at line ${line.number}`);
    const [, indent, star, remainder] = inner;
    marker = star ?? "block";
    text = remainder;
  }

  const closeIndex = text.indexOf("*/");
  if (closeIndex >= 0) text = text.slice(0, closeIndex);
  const content = text.trim();
  let blankText: string | null = null;

  if (!isOpening) {
    const innerPrefix = /^(\s*)(\*)?/.exec(line.text);
    if (innerPrefix) blankText = innerPrefix[2] ? `${innerPrefix[1]}*` : "";
  }

  return {
    source: line,
    content,
    marker,
    blankText,
    directive: isDirective(content),
  };
}

function hasUnescapedBacktick(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] !== "`") continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

function opaqueRegionEnds(line: string, region: OpaqueRegion): boolean {
  if (region.kind === "backtick") return hasUnescapedBacktick(line, 0) >= 0;
  if (region.kind === "swift-triple-string") return line.includes('"""');
  if (region.kind === "shell-heredoc") return line.trim() === region.delimiter;
  return line.includes("*/");
}

function startsOpaqueRegion(line: string): OpaqueRegion | null {
  let quote: "single" | "double" | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if ((quote === "single" && character === "'") || (quote === "double" && character === '"')) {
        quote = null;
      }
      continue;
    }

    if (line.startsWith("//", index)) return null;
    if (line.startsWith("/*", index)) {
      const close = line.indexOf("*/", index + 2);
      if (close < 0) return { kind: "inline-block-comment" };
      index = close + 1;
      continue;
    }
    if (line.startsWith('"""', index)) {
      const close = line.indexOf('"""', index + 3);
      if (close < 0) return { kind: "swift-triple-string" };
      index = close + 2;
      continue;
    }
    if (character === "`") {
      const close = hasUnescapedBacktick(line, index + 1);
      if (close < 0) return { kind: "backtick" };
      index = close;
      continue;
    }
    if (character === "'") quote = "single";
    if (character === '"') quote = "double";
  }

  return null;
}

function startsShellHeredoc(line: string): OpaqueRegion | null {
  const match = /(?:^|[\s;(])<<-?\s*([^\s;&|]+)/.exec(line);
  let token = match?.[1] ?? "";
  if (!token) return null;
  if (
    (token.startsWith('"') && token.endsWith('"') && token.length >= 2) ||
    (token.startsWith("'") && token.endsWith("'") && token.length >= 2)
  ) {
    token = token.slice(1, -1);
  }
  const delimiter = token.replace(/\\(.)/g, "$1");
  return delimiter ? { kind: "shell-heredoc", delimiter } : null;
}

function collectCommentRuns(filePath: string, lines: SourceLine[]): CommentRun[] {
  const runs: CommentRun[] = [];
  let lineRun: CommentRun | null = null;
  let blockRun: CommentRun | null = null;
  let opaqueRegion: OpaqueRegion | null = null;
  const isShellSource = extname(filePath) === ".sh";

  for (const line of lines) {
    if (opaqueRegion) {
      if (opaqueRegionEnds(line.text, opaqueRegion)) opaqueRegion = null;
      continue;
    }

    if (blockRun) {
      blockRun.lines.push(blockInnerLine(line, false));
      if (line.text.includes("*/")) {
        runs.push(blockRun);
        blockRun = null;
      }
      continue;
    }

    if (isShellSource) {
      const heredoc = startsShellHeredoc(line.text);
      if (heredoc) {
        if (lineRun) {
          runs.push(lineRun);
          lineRun = null;
        }
        opaqueRegion = heredoc;
        continue;
      }
    }

    const fullLine = lineComment(line, isShellSource);
    if (fullLine) {
      if (!lineRun) lineRun = { style: "line", lines: [] };
      lineRun.lines.push(fullLine);
      continue;
    }

    if (lineRun) {
      runs.push(lineRun);
      lineRun = null;
    }

    if (/^\s*\{?\/\*\*?/.test(line.text)) {
      const opening = blockInnerLine(line, true);
      if (line.text.includes("*/")) {
        runs.push({ style: "block", lines: [opening] });
      } else {
        blockRun = { style: "block", lines: [opening] };
      }
      continue;
    }

    opaqueRegion = startsOpaqueRegion(line.text);
  }

  if (lineRun) runs.push(lineRun);
  if (blockRun) runs.push(blockRun);
  return runs;
}

function classify(line: CommentLine): ClassifiedLine {
  if (line.content.trim() === "") return { comment: line, language: null };
  if (hasInlineBilingualLabel(line.content)) return { comment: line, language: "mixed" };
  const proseWithoutExamples = stripInlineExamples(line.content);
  return {
    comment: line,
    language: HAN_PATTERN.test(line.content) && !/[A-Za-z]/.test(proseWithoutExamples)
      ? "han"
      : HAN_PATTERN.test(proseWithoutExamples)
        ? "han"
        : "non-han",
  };
}

function hasInlineBilingualLabel(content: string): boolean {
  return HAN_PATTERN.test(content) && /[A-Za-z].*(?:\s\/\s|\s[—-]\s).*\p{Script=Han}/u.test(content);
}

function stripInlineExamples(content: string): string {
  return content
    .replace(/`[^`]*`/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/'[^']*'/g, "")
    .replace(/\([^)]*\)/g, "");
}

function expectedBoundaryMarker(previous: CommentLine, next: CommentLine): string | null {
  if (next.blankText === null) return previous.blankText;
  if (previous.blankText === null) return next.blankText;

  if (previous.marker === next.marker) return next.blankText;
  if (previous.marker.startsWith("/*") && next.marker === "*") return next.blankText;
  return null;
}

function finding(file: string, line: number, kind: FindingKind, message: string): Finding {
  return { file, line, kind, message };
}

function analyzeRun(filePath: string, run: CommentRun): Analysis {
  const findings: Finding[] = [];
  const insertions: PlannedInsertion[] = [];

  const classified = run.lines.map(classify);
  let previousContentIndex = -1;
  let hasOrderedBoundary = false;

  for (let index = 0; index < classified.length; index += 1) {
    const current = classified[index];
    if (current.comment.directive) {
      previousContentIndex = -1;
      continue;
    }
    if (current.language === "mixed") {
      previousContentIndex = -1;
      continue;
    }
    if (current.language === null) continue;
    if (previousContentIndex < 0) {
      previousContentIndex = index;
      continue;
    }

    const previous = classified[previousContentIndex];
    if (previous.language === current.language) {
      previousContentIndex = index;
      continue;
    }

    const separators = classified.slice(previousContentIndex + 1, index);
    if (previous.language === "han" && current.language === "non-han") {
      if (hasOrderedBoundary) {
        const expectedMarker = expectedBoundaryMarker(previous.comment, current.comment);
        if (expectedMarker === null) {
          findings.push(
            finding(
              filePath,
              current.comment.source.number,
              "ambiguous-boundary",
              "paragraph boundary uses incompatible comment markers and requires manual review",
            ),
          );
        } else if (separators.length === 0) {
          findings.push(
            finding(
              filePath,
              current.comment.source.number,
              "missing-separator",
              "new English paragraph after a Chinese section requires one comment-only separator",
            ),
          );
          insertions.push({
            beforeOffset: current.comment.source.offset,
            line: current.comment.source.number,
            text: `${expectedMarker}${current.comment.source.ending || previous.comment.source.ending || "\n"}`,
          });
        } else if (separators.length > 1) {
          findings.push(
            finding(
              filePath,
              separators[1].comment.source.number,
              "extra-separator",
              "language boundary must contain exactly one comment-only separator",
            ),
          );
        } else if (separators[0].comment.source.text !== expectedMarker) {
          findings.push(
            finding(
              filePath,
              separators[0].comment.source.number,
              "mismatched-separator",
              "language-boundary separator must match the surrounding comment marker and indentation",
            ),
          );
        }
        previousContentIndex = index;
        continue;
      }
      findings.push(
        finding(
          filePath,
          current.comment.source.number,
          "reversed-order",
          "Chinese-to-non-Chinese transition requires manual language-order correction",
        ),
      );
      previousContentIndex = index;
      continue;
    }

    const expectedMarker = expectedBoundaryMarker(previous.comment, current.comment);
    if (expectedMarker === null) {
      findings.push(
        finding(
          filePath,
          current.comment.source.number,
          "ambiguous-boundary",
          "language boundary uses incompatible comment markers and requires manual review",
        ),
      );
      previousContentIndex = index;
      continue;
    }

    if (separators.length === 0) {
      if (current.comment.blankText === null && previous.comment.blankText === null) {
        findings.push(
          finding(
            filePath,
            current.comment.source.number,
            "ambiguous-boundary",
            "language boundary cannot be separated without rewriting an existing line",
          ),
        );
      } else {
        findings.push(
          finding(
            filePath,
            current.comment.source.number,
            "missing-separator",
            "English-to-Chinese transition requires one comment-only separator",
          ),
        );
        insertions.push({
          beforeOffset: current.comment.source.offset,
          line: current.comment.source.number,
          text: `${expectedMarker}${current.comment.source.ending || previous.comment.source.ending || "\n"}`,
        });
      }
      hasOrderedBoundary = true;
      previousContentIndex = index;
      continue;
    }

    if (separators.length > 1) {
      findings.push(
        finding(
          filePath,
          separators[1].comment.source.number,
          "extra-separator",
          "language boundary must contain exactly one comment-only separator",
        ),
      );
      previousContentIndex = index;
      continue;
    }

    const separator = separators[0].comment;
    if (separator.source.text !== expectedMarker) {
      findings.push(
        finding(
          filePath,
          separator.source.number,
          "mismatched-separator",
          "language-boundary separator must match the surrounding comment marker and indentation",
        ),
      );
    }
    hasOrderedBoundary = true;
    previousContentIndex = index;
  }

  return { findings, insertions };
}

/**
 * Analyzes one source file without modifying it.
 *
 * 分析单个源码文件, 不修改其内容.
 */
export function analyzeSource(filePath: string, source: string): Analysis {
  const findings: Finding[] = [];
  const insertions: PlannedInsertion[] = [];

  for (const run of collectCommentRuns(filePath, splitSourceLines(source))) {
    const analysis = analyzeRun(filePath, run);
    findings.push(...analysis.findings);
    insertions.push(...analysis.insertions);
  }

  return { findings, insertions };
}

/**
 * Applies planned separator insertions and proves that every original byte is unchanged.
 *
 * 应用计划中的分隔行插入, 并证明所有原始字节均保持不变.
 */
export function applyInsertionFix(source: string, insertions: readonly PlannedInsertion[]): string {
  if (insertions.length === 0) return source;

  const ordered = [...insertions].sort((left, right) => left.beforeOffset - right.beforeOffset);
  const candidateParts: string[] = [];
  const insertedRanges: Array<{ start: number; end: number }> = [];
  let sourceOffset = 0;
  let candidateOffset = 0;

  for (const insertion of ordered) {
    if (insertion.beforeOffset < sourceOffset || insertion.beforeOffset > source.length) {
      throw new Error(`invalid or overlapping insertion before line ${insertion.line}`);
    }
    const unchanged = source.slice(sourceOffset, insertion.beforeOffset);
    candidateParts.push(unchanged, insertion.text);
    candidateOffset += unchanged.length;
    insertedRanges.push({ start: candidateOffset, end: candidateOffset + insertion.text.length });
    candidateOffset += insertion.text.length;
    sourceOffset = insertion.beforeOffset;
  }
  candidateParts.push(source.slice(sourceOffset));
  const candidate = candidateParts.join("");

  let restored = candidate;
  for (const range of insertedRanges.reverse()) {
    restored = restored.slice(0, range.start) + restored.slice(range.end);
  }
  if (!Buffer.from(restored, "utf8").equals(Buffer.from(source, "utf8"))) {
    throw new Error("insertion-only byte invariant failed; refusing to write candidate output");
  }
  return candidate;
}

async function collectFiles(root: string, repositoryRoot: string): Promise<string[]> {
  const rootRelativePath = normalizePath(relative(repositoryRoot, root));
  if (!isIncludedRepositoryRelativePath(rootRelativePath)) return [];

  const info = await stat(root);
  if (info.isFile()) {
    const relativePath = normalizePath(relative(repositoryRoot, root));
    return isIncludedSourcePath(relativePath) ? [root] : [];
  }

  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = resolve(root, entry.name);
    const relativePath = normalizePath(relative(repositoryRoot, absolutePath));
    if (entry.isDirectory()) {
      const segments = relativePath.split("/");
      if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) continue;
      if (entry.name.endsWith(".xcodeproj") || entry.name.endsWith(".xcworkspace")) continue;
      if (relativePath === "web/src/i18n/locales" || relativePath === "android/src/i18n/locales") continue;
      files.push(...(await collectFiles(absolutePath, repositoryRoot)));
    } else if (entry.isFile() && isIncludedSourcePath(relativePath)) {
      files.push(absolutePath);
    }
  }
  return files;
}

function isIncludedRepositoryRelativePath(relativePath: string): boolean {
  return relativePath === "" || (!relativePath.startsWith("../") && relativePath !== ".." && !isAbsolute(relativePath));
}

async function runCli(args: string[]): Promise<number> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, "..");
  const fix = args.includes("--fix");
  const unknownOptions = args.filter((argument) => argument.startsWith("--") && argument !== "--fix" && argument !== "--check");
  if (unknownOptions.length > 0) {
    console.error(`unknown option: ${unknownOptions[0]}`);
    return 2;
  }

  const requestedRoots = args.filter((argument) => !argument.startsWith("--"));
  const roots = requestedRoots.length > 0 ? requestedRoots.map((root) => resolve(root)) : [repositoryRoot];
  const discovered = new Set<string>();
  for (const root of roots) {
    for (const file of await collectFiles(root, repositoryRoot)) discovered.add(file);
  }

  let changedFiles = 0;
  const remainingFindings: Finding[] = [];
  for (const file of [...discovered].sort()) {
    const relativePath = normalizePath(relative(repositoryRoot, file));
    const source = await readFile(file, "utf8");
    const analysis = analyzeSource(relativePath, source);
    if (fix && analysis.insertions.length > 0) {
      const candidate = applyInsertionFix(source, analysis.insertions);
      await writeFile(file, candidate, "utf8");
      changedFiles += 1;
      remainingFindings.push(...analyzeSource(relativePath, candidate).findings);
    } else {
      remainingFindings.push(...analysis.findings);
    }
  }

  for (const issue of remainingFindings) {
    console.error(`${issue.file}:${issue.line}: ${issue.kind}: ${issue.message}`);
  }
  if (fix && changedFiles > 0) console.log(`inserted bilingual separators in ${changedFiles} file(s)`);
  if (remainingFindings.length === 0) {
    console.log("bilingual comment spacing OK");
    return 0;
  }
  console.error(`\n${remainingFindings.length} bilingual comment spacing issue(s)`);
  return 1;
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  void runCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    },
  );
}
