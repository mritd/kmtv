/**
 * sync/normalizeKey.ts — record key normalization shared with the server.
 *
 * sync/normalizeKey.ts — 与服务端一致的记录 key 归一化.
 *
 * The whitespace set mirrors server/internal/model/sync.go; testdata/sync-key-vectors.json pins it.
 *
 * 空白字符集合与 server/internal/model/sync.go 一致, 由 testdata/sync-key-vectors.json 固定.
 *
 * Shared verbatim with android/src/sync/. Import only sibling modules here.
 *
 * 与 android/src/sync/ 逐字共享. 这里只能导入同目录模块.
 */

const SPACE_CLASS = "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const SPACE_RUN = new RegExp(`${SPACE_CLASS}+`, "u");
const EDGE_SPACE = new RegExp(`^${SPACE_CLASS}+|${SPACE_CLASS}+$`, "gu");

// lowerCodePoint lowercases one code point and keeps only the first code point of the result.
// Go's unicode.ToLower maps one rune to one rune, so "İ" becomes "i", not "i̇".
//
// lowerCodePoint 将单个码点转为小写, 结果只保留第一个码点. Go 的 unicode.ToLower 是逐码点一对一
// 映射, 所以 "İ" 变为 "i", 而不是 "i̇".
function lowerCodePoint(char: string): string {
  return String.fromCodePoint(char.toLowerCase().codePointAt(0) ?? 0);
}

/**
 * normalizeSyncKey trims, collapses internal whitespace to one space, and lowercases each code point.
 *
 * normalizeSyncKey 去掉首尾空白, 将内部连续空白合并为一个空格, 再逐码点转为小写.
 */
export function normalizeSyncKey(value: string): string {
  const collapsed = value
    .split(SPACE_RUN)
    .filter((part) => part !== "")
    .join(" ");
  let lowered = "";
  for (const char of collapsed) lowered += lowerCodePoint(char);
  return lowered;
}

/**
 * trimSyncText removes leading and trailing sync whitespace and keeps the inside unchanged.
 *
 * trimSyncText 去掉首尾的同步空白字符, 内部内容保持不变.
 */
export function trimSyncText(value: string): string {
  return value.replace(EDGE_SPACE, "");
}
