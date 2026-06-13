// FlatList perf knobs shared across vertical lists, grids, and horizontal rows.
// FlatList 性能参数, 在垂直列表、网格、水平行之间复用.

/**
 * Default vertical FlatList perf options.
 * Use for single-column lists (Search results, Favorites, Admin tabs).
 * 默认垂直 FlatList 性能选项. 适用于单列列表 (搜索、收藏、Admin 各页).
 */
export const LIST_PERF_DEFAULT = {
  removeClippedSubviews: true,
  windowSize: 5,
  initialNumToRender: 10,
  maxToRenderPerBatch: 8,
  updateCellsBatchingPeriod: 50,
} as const;

/**
 * Multi-column poster grid (Categories).
 * 多列海报网格 (Categories).
 */
export const LIST_PERF_GRID = {
  removeClippedSubviews: true,
  windowSize: 5,
  initialNumToRender: 15,
  maxToRenderPerBatch: 10,
  updateCellsBatchingPeriod: 50,
} as const;

/**
 * Horizontal paged or scrolling rows (HeroCarousel, SectionRow).
 * 水平分页或滚动行 (HeroCarousel, SectionRow).
 */
export const LIST_PERF_HORIZONTAL = {
  removeClippedSubviews: true,
  windowSize: 7,
  initialNumToRender: 6,
  maxToRenderPerBatch: 4,
  updateCellsBatchingPeriod: 50,
} as const;
