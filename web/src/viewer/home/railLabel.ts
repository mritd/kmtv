/**
 * railLabel — pure helper for translating Douban section names to localised rail labels.
 * railLabel — 纯函数模块, 将豆瓣分区名称翻译为本地化的 rail 标签.
 *
 * Responsibilities / 职责:
 *   - Look up `home.rails.<name>` in the "viewer" i18n namespace
 *     — 在 "viewer" i18n 命名空间中查找 home.rails.<name>
 *   - Fall back to the raw section name when no translation is defined
 *     — 当没有对应翻译时退回到原始 section name
 *
 * Key exports / 主要导出:
 *   translateRailName
 *
 * Callers / 调用方:
 *   viewer/home/HomePage.tsx (section headings in the poster rail)
 *   viewer/home/HomeHero.tsx (section eyebrow and meta chip in the hero)
 *
 * Pure function — no side effects beyond the i18next lookup.
 * 纯函数 — 除 i18next 查找外无副作用.
 */

import type { TFunction } from "i18next";

/**
 * translateRailName maps a raw Douban section name to its localised display label.
 * translateRailName
 * 将原始豆瓣分区名称映射为本地化的显示标签.
 *
 * The lookup key is `home.rails.<name>` in the "viewer" namespace. If the key is not
 * defined, i18next returns `defaultValue` — the raw `name` — so untranslated sections
 * degrade gracefully instead of showing a raw i18n key string.
 * 查找键为 "viewer" 命名空间中的 home.rails.<name>. 若键不存在, i18next 返回 defaultValue
 * (即原始 name), 确保未翻译的分区优雅降级而非展示原始 i18n key 字符串.
 *
 * The `as never` cast is intentional: the key string is dynamically constructed and
 * therefore not statically in the i18next type map; casting avoids a false-negative TS error.
 * as never 强制类型转换是有意为之: key 字符串为动态构造, 不在 i18next 静态类型映射中,
 * 强转可避免误报的 TS 类型错误.
 *
 * @param t    - The `t` function from `useTranslation("viewer")`.
 *               来自 useTranslation("viewer") 的 t 函数.
 * @param name - The raw section name from the API (e.g. "热门电影").
 *               来自 API 的原始分区名 (例如 "热门电影").
 * @returns    The localised label, or `name` if no translation exists.
 *             本地化标签; 若无翻译则返回 name 本身.
 */
export function translateRailName(t: TFunction<"viewer", undefined>, name: string): string {
  return t(`home.rails.${name}` as never, { defaultValue: name });
}
