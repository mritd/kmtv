/**
 * store/index.ts — barrel re-export for all Zustand store modules.
 * store/index.ts — 所有 Zustand store 模块的统一桶导出.
 *
 * Responsibilities / 职责:
 *   - Re-export every store instance, type, and utility from sub-modules — 重新导出所有 store 实例、类型和工具函数
 *   - Provide a single import surface so callers never need to know internal paths — 提供单一导入入口, 调用方无需感知内部路径
 *
 * Key exports / 主要导出:
 *   searchStore, SearchStoreState, SearchStatus, SearchProgressMap, SearchCancelReason
 *   detailStore, detailEntryKey, DetailEntry, DetailState
 *   adminModalStore, AdminModalPayload, AdminModalState
 *   useI18nStore, Lang
 *
 * Callers / 调用方:
 *   Any component or hook that reads or writes application state.
 *   任何读取或写入应用状态的组件或 hook.
 *
 * TIER 4 LOCKED — do NOT remove or rename any existing re-export; additions are free.
 * Tier 4 锁定 — 不得删除或重命名任何现有重导出; 可以新增.
 */

/**
 * searchStore — Zustand vanilla store for SSE-backed search lifecycle.
 * searchStore — 支持 SSE 的搜索生命周期 Zustand vanilla store.
 */
export { searchStore } from "./searchStore";

/**
 * SearchStoreState — full state + action shape of searchStore.
 * SearchStatus — "idle" | "loading" | "success" | "error".
 * SearchProgressMap — phase-keyed progress events from the SSE stream.
 * SearchCancelReason — reason passed to cancel() for telemetry and UX branching.
 *
 * SearchStoreState — searchStore 的完整状态与 action 定义.
 * SearchStatus — 搜索状态枚举.
 * SearchProgressMap — SSE 流中以阶段为键的进度事件.
 * SearchCancelReason — 传给 cancel() 的取消原因, 用于埋点和 UX 分支.
 */
export type {
  SearchStoreState,
  SearchStatus,
  SearchProgressMap,
  SearchCancelReason,
} from "./searchStore";

/**
 * detailStore — Zustand vanilla store for per-video detail and playback state.
 * detailEntryKey — derive the LRU cache key from (sourceKey, videoID).
 *
 * detailStore — 按视频维护详情与播放状态的 Zustand vanilla store.
 * detailEntryKey — 由 (sourceKey, videoID) 生成 LRU 缓存 key.
 */
export { detailStore, detailEntryKey } from "./detailStore";

/**
 * DetailEntry — single entry in the LRU detail cache (bundle, playback, selection).
 * DetailState — full state + action shape of detailStore.
 *
 * DetailEntry — LRU 缓存中的单条视频详情 (bundle, 播放, 选源).
 * DetailState — detailStore 的完整状态与 action 定义.
 */
export type { DetailEntry, DetailState } from "./detailStore";

/**
 * adminModalStore — Zustand vanilla store driving the admin modal dialog.
 * adminModalStore — 驱动管理弹窗的 Zustand vanilla store.
 */
export { adminModalStore } from "./adminModalStore";

/**
 * AdminModalPayload — discriminated union of all modal operation contexts.
 * AdminModalState — full state + action shape of adminModalStore.
 *
 * AdminModalPayload — 所有弹窗操作上下文的判别联合类型.
 * AdminModalState — adminModalStore 的完整状态与 action 定义.
 */
export type { AdminModalPayload, AdminModalState } from "./adminModalStore";

/**
 * useI18nStore — Zustand hook store persisting the device-level language preference.
 * useI18nStore — 持久化设备级语言偏好的 Zustand hook store.
 */
export { useI18nStore } from "./i18nStore";

/**
 * Lang — supported locale identifiers: "zh" | "en".
 * Lang — 支持的语言标识: "zh" | "en".
 */
export type { Lang } from "./i18nStore";
