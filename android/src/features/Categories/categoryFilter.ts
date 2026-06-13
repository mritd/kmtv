// Pure resolution from (groups + persisted selection) to a recommend filter.
// 从 (分组 + 持久化选择) 到推荐筛选参数的纯函数解析.

import type { CategoryGroup, Region, SubCategory } from "@/api/types";
import type { RecommendFilterKey } from "@/api/viewerHooks";

/**
 * CategorySelection — the persisted identity (names/keys, not object refs).
 * CategorySelection — 持久化的选择标识 (名称/键, 非对象引用).
 *
 * Storing identifiers keeps the selection valid across category metadata refetches where
 * object references change.
 * 以标识符存储, 元数据重取后 (对象引用变化) 选择仍然有效.
 */
export interface CategorySelection {
  groupKey: string | null;
  subName: string | null;
  regionName: string | null;
}

/**
 * ResolvedSelection — concrete group / sub / region objects the selection currently points at.
 * ResolvedSelection — 选择当前指向的具体 group / sub / region 对象.
 */
export interface ResolvedSelection {
  group: CategoryGroup | null;
  sub: SubCategory | null;
  region: Region | null;
}

/**
 * resolveSelection maps a stored selection to concrete objects from the loaded groups.
 * resolveSelection 将存储的选择映射为已加载分组中的具体对象.
 *
 * Each field falls back independently to the first available option when its identifier is
 * null or unknown — this is what powers "switch group → reset sub/region" (old names no
 * longer exist in the new group).
 * 各字段在标识符为 null 或未知时独立回退到首个可用选项, 这是「切换分组 → 重置子分类/地区」
 * 的实现方式 (旧名称在新分组中已不存在).
 */
export function resolveSelection(groups: CategoryGroup[], selection: CategorySelection): ResolvedSelection {
  const group = groups.find((g) => g.key === selection.groupKey) ?? groups[0] ?? null;
  if (!group) return { group: null, sub: null, region: null };
  const sub = group.subcategories.find((s) => s.name === selection.subName) ?? group.subcategories[0] ?? null;
  const region = group.regions.find((r) => r.name === selection.regionName) ?? group.regions[0] ?? null;
  return { group, sub, region };
}

/**
 * resolveRecommendFilter derives the recommend filter parameters from a resolved selection.
 * resolveRecommendFilter 从已解析的选择推导推荐筛选参数.
 *
 * Mirrors iOS CategoriesViewModel rules verbatim:
 *   kind   = sub.kind ?? group.douban_kind
 *   tag    = sub.tag  ?? ""
 *   format = sub HAS its own kind ? (sub.format ?? "") : group.format       (presence-test only)
 *   region = region.value ?? ""
 * The format rule is subtle: a sub carrying `kind` (even empty) overrides format; otherwise the
 * group format applies. Returns empty `kind` when group is null — this disables the infinite query.
 * 与 iOS CategoriesViewModel 规则逐字一致 (见上). format 仅做存在性测试 (sub 一旦带有 kind 就覆盖 format).
 * group 为 null 时返回空 kind, 用以禁用无限查询.
 */
export function resolveRecommendFilter(resolved: ResolvedSelection): RecommendFilterKey {
  const { group, sub, region } = resolved;
  if (!group) return { kind: "", tag: "", format: "", region: "" };
  const subHasKind = sub?.kind != null;
  return {
    kind: sub?.kind ?? group.douban_kind,
    tag: sub?.tag ?? "",
    format: subHasKind ? (sub?.format ?? "") : group.format,
    region: region?.value ?? "",
  };
}
