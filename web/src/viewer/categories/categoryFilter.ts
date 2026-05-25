/**
 * categoryFilter — pure resolution from (category groups + user selection) to a recommend filter.
 * categoryFilter — 从 (分类分组 + 用户选择) 到推荐筛选参数的纯函数解析.
 *
 * Responsibilities / 职责:
 *   - resolveSelection: map the stored selection keys to concrete group/sub/region objects with
 *     graceful fallback to each group's first option — 将存储的选择键映射为具体的 group/sub/region 对象, 并优雅回退到每个分组的首个选项
 *   - resolveRecommendFilter: derive the kind/tag/format/region query fields, mirroring the iOS
 *     CategoriesViewModel contract exactly — 推导 kind/tag/format/region 查询字段, 与 iOS CategoriesViewModel 契约逐字一致
 *
 * Why this is isolated and pure / 为何独立为纯函数:
 *   The format-resolution rule is non-obvious (format follows the sub-category only when the
 *   sub-category carries its own kind, otherwise the group format applies). Keeping it pure makes
 *   the rule directly testable and the single source of truth shared with the backend semantics.
 *   format 解析规则不直观 (仅当子分类自带 kind 时 format 跟随子分类, 否则用分组 format).
 *   保持纯函数使该规则可直接测试, 并作为与后端语义共享的唯一真相来源.
 *
 * Key exports / 主要导出:
 *   ResolvedSelection, resolveSelection, resolveRecommendFilter
 *
 * Callers / 调用方:
 *   viewer/categories/CategoriesPage.tsx — renders active chips + drives useDoubanRecommendInfiniteQuery
 */

import type { RecommendFilterKey } from "@/api/viewerHooks";
import type { CategoryGroup, Region, SubCategory } from "@/api/types";

/**
 * CategorySelection — the persisted selection identity (names/keys, not object references).
 * CategorySelection — 持久化的选择标识 (名称/键, 非对象引用).
 *
 * Stored as plain identifiers so the selection survives a fresh category fetch where object
 * references change. `null` means "no explicit choice yet" and resolves to the first option.
 * 以纯标识符存储, 使选择在分类数据重新拉取 (对象引用变化) 后仍然有效.
 * null 表示「尚未显式选择」, 解析时回退到首个选项.
 */
export interface CategorySelection {
  groupKey: string | null;
  subName: string | null;
  regionName: string | null;
}

/**
 * ResolvedSelection — the concrete group/sub/region objects a selection currently points at.
 * ResolvedSelection — 选择当前指向的具体 group/sub/region 对象.
 *
 * Any field is null only when the source list is empty (no groups, or a group without regions).
 * 仅当源列表为空时字段才为 null (无分组, 或分组无地区).
 */
export interface ResolvedSelection {
  group: CategoryGroup | null;
  sub: SubCategory | null;
  region: Region | null;
}

/**
 * resolveSelection maps a stored selection onto concrete objects from the loaded category groups.
 * resolveSelection
 * 将存储的选择映射到已加载分类分组中的具体对象.
 *
 * Fallback rules (each independent): an unknown or null groupKey resolves to the first group;
 * an unknown or null subName resolves to that group's first sub-category; an unknown or null
 * regionName resolves to that group's first region. This is what makes "switch group → reset
 * sub/region" work: after a group switch the old sub/region names no longer exist in the new
 * group, so both fall back to the new group's first option (matching iOS selectGroup).
 * 回退规则 (彼此独立): 未知或 null 的 groupKey 回退到首个分组;
 * 未知或 null 的 subName 回退到该分组首个子分类; 未知或 null 的 regionName 回退到该分组首个地区.
 * 这正是「切换分组 → 重置子分类/地区」的实现方式: 切换分组后旧的子分类/地区名称在新分组中已不存在,
 * 因此都回退到新分组的首个选项 (与 iOS selectGroup 一致).
 */
export function resolveSelection(groups: CategoryGroup[], selection: CategorySelection): ResolvedSelection {
  const group = groups.find((g) => g.key === selection.groupKey) ?? groups[0] ?? null;
  if (!group) {
    return { group: null, sub: null, region: null };
  }
  const sub = group.subcategories.find((s) => s.name === selection.subName) ?? group.subcategories[0] ?? null;
  const region = group.regions.find((r) => r.name === selection.regionName) ?? group.regions[0] ?? null;
  return { group, sub, region };
}

/**
 * resolveRecommendFilter derives the /douban/recommend/filter query fields from a resolved selection.
 * resolveRecommendFilter
 * 从已解析的选择推导 /douban/recommend/filter 的查询字段.
 *
 * Mirrors the iOS CategoriesViewModel contract exactly:
 *   kind   = sub.kind ?? group.douban_kind
 *   tag    = sub.tag  ?? ""
 *   format = sub HAS its own kind ? (sub.format ?? "") : group.format
 *   region = region.value ?? ""
 * The format rule is the subtle one: a sub-category only overrides format when it also carries
 * its own kind; otherwise the group-level format applies. Returns an empty `kind` when group is
 * null, which disables useDoubanRecommendInfiniteQuery (kind is backend-required).
 * 与 iOS CategoriesViewModel 契约逐字一致 (见上). format 规则最微妙: 子分类仅在自带 kind 时才覆盖 format,
 * 否则使用分组级 format. 当 group 为 null 时返回空 kind, 这会禁用 useDoubanRecommendInfiniteQuery (后端必填 kind).
 */
export function resolveRecommendFilter(resolved: ResolvedSelection): RecommendFilterKey {
  const { group, sub, region } = resolved;
  if (!group) {
    return { kind: "", tag: "", format: "", region: "" };
  }
  // Presence test only (mirrors iOS `sub?.kind != nil`): a sub-category that explicitly carries a
  // `kind` field — even an empty one — overrides format. Do NOT also require non-empty here.
  // 仅判断是否存在 (对应 iOS `sub?.kind != nil`): 子分类只要显式带有 kind 字段 (即便为空) 即覆盖 format.
  // 此处不得额外要求非空.
  const subHasKind = sub?.kind != null;
  return {
    kind: sub?.kind ?? group.douban_kind,
    tag: sub?.tag ?? "",
    format: subHasKind ? (sub?.format ?? "") : group.format,
    region: region?.value ?? "",
  };
}
