/**
 * animation/viewTransitions — thin wrapper around the View Transitions API with a graceful fallback.
 * animation/viewTransitions — 对 View Transitions API 的薄封装, 不支持时优雅降级.
 *
 * Responsibility / 职责:
 *   Provides a safe, testable abstraction over `document.startViewTransition` so that
 *   callers never need to feature-detect the API themselves.  Also generates stable
 *   CSS `view-transition-name` identifiers for poster images across page navigations.
 *   为调用方屏蔽 `document.startViewTransition` 的特性检测, 并生成跨页导航时海报图的稳定
 *   CSS `view-transition-name` 标识符.
 *
 * Browser support / 浏览器支持:
 *   Chromium 111+ and Safari 18 expose `document.startViewTransition`.
 *   All other environments fall back to a direct synchronous/async callback call that
 *   returns a `{ finished: Promise<void> }` shim — callers are unaware of the difference.
 *   Chromium 111+ 及 Safari 18 提供 `document.startViewTransition`.
 *   其他环境直接调用回调并返回 `{ finished: Promise<void> }` 垫片, 调用方无感知.
 *
 * Exports / 导出:
 *   - ViewTransitionUpdate   — callback signature accepted by the API
 *   - ViewTransitionLike     — minimal subset of the real ViewTransition object used by callers
 *   - supportsViewTransitions — boolean feature-detect (injected doc for testability)
 *   - runViewTransition       — safe dispatcher (real API or shim)
 *   - posterTransitionName    — CSS-safe `view-transition-name` generator for poster images
 *
 * Callers / 调用方:
 *   viewer/components/VideoResultCard.tsx — imports posterTransitionName to set
 *   view-transition-name on poster thumbnails.  supportsViewTransitions and
 *   runViewTransition have no production callers yet; they are exported for future
 *   router-level navigation wrappers.
 *   viewer/components/VideoResultCard.tsx 使用 posterTransitionName 为海报缩略图写入
 *   view-transition-name. supportsViewTransitions 和 runViewTransition 暂无生产调用方,
 *   已导出供将来路由层导航包装器使用.
 *
 * Vitest coverage exclude rationale / 排除原因:
 *   vitest.config.ts excludes `src/animation/**` from *coverage* (not from test discovery).
 *   A sibling __tests__/viewTransitions.test.ts exists and exercises the fallback shim and
 *   posterTransitionName using a fake Document object; however, because happy-dom does not
 *   implement startViewTransition, full integration coverage requires a real Chromium
 *   browser (Wave 4 E2E scope).
 *   vitest.config.ts 将 `src/animation/**` 排除于覆盖率统计 (而非测试发现). 相邻的
 *   __tests__/viewTransitions.test.ts 已通过伪 Document 对象测试降级垫片和 posterTransitionName;
 *   但完整集成覆盖需要真实 Chromium 环境 (Wave 4 E2E 范围).
 */

// ViewTransitionUpdate — callback signature passed to startViewTransition.
// ViewTransitionUpdate — 传入 startViewTransition 的回调签名.
//
// May be sync or async; the browser awaits the returned promise (if any) before
// capturing the "after" screenshot for the cross-fade.
// 可以同步也可以异步; 浏览器会等待返回的 Promise (如有) 后再截取"之后"快照进行交叉淡变.
export type ViewTransitionUpdate = () => void | Promise<void>;

// ViewTransitionLike — the minimal ViewTransition interface consumed by callers.
// ViewTransitionLike — 调用方消费的最小 ViewTransition 接口.
//
// WHY `Promise<unknown>` rather than `Promise<void>`:
// The real ViewTransition.finished spec resolves to undefined but some early
// Chromium betas resolved to a DOMTransition object.  Using `unknown` instead of
// `void` means our shim and the real API are both assignable to this type without
// a cast, and downstream callers that only await `.finished` are unaffected.
// 使用 `unknown` 而非 `void` 的原因: 真实 ViewTransition.finished 规范解析为 undefined,
// 但早期 Chromium 测试版解析为 DOMTransition 对象. 用 `unknown` 使垫片与真实 API
// 都可赋值给此类型, 无需强制转换, 且下游调用方仅 await `.finished` 时不受影响.
export interface ViewTransitionLike {
  finished: Promise<unknown>;
}

// StartViewTransitionCapable — private structural type for the feature-detected document shape.
// StartViewTransitionCapable — 特性检测后文档的私有结构类型.
interface StartViewTransitionCapable {
  startViewTransition(update: ViewTransitionUpdate): ViewTransitionLike;
}

// asCapable — narrows a Document to StartViewTransitionCapable when the API is present.
// asCapable — 当 API 存在时将 Document 收窄为 StartViewTransitionCapable.
//
// WHY two-step cast via Partial<>: TypeScript's DOM lib does not yet include
// startViewTransition, so a direct property access on Document would be a type error.
// Casting to Partial<StartViewTransitionCapable> first lets us do a safe runtime
// typeof check before the final, justified `as StartViewTransitionCapable` cast.
// 两步转换原因: TypeScript DOM 类型库尚未包含 startViewTransition, 直接访问 Document
// 属性会报类型错误. 先转为 Partial<> 允许运行时 typeof 检查, 之后的 `as` 转换才有根据.
function asCapable(doc: Document): StartViewTransitionCapable | null {
  const candidate = doc as Partial<StartViewTransitionCapable>;
  return typeof candidate.startViewTransition === "function" ? (candidate as StartViewTransitionCapable) : null;
}

// supportsViewTransitions — returns true when the View Transitions API is available on `doc`.
// supportsViewTransitions — 当 `doc` 上 View Transitions API 可用时返回 true.
//
// `doc` defaults to the global `document` but is injectable for unit/SSR isolation.
// `doc` 默认使用全局 `document`, 可注入以支持单元测试或 SSR 环境隔离.
export function supportsViewTransitions(doc: Document = document): boolean {
  return asCapable(doc) !== null;
}

// runViewTransition — executes `update` inside a view transition when supported; falls back to a plain call.
// runViewTransition — 支持时在 view transition 中执行 `update`, 否则直接调用.
//
// `doc` defaults to the global `document` and is injectable for testing.
// `doc` 默认使用全局 `document`, 可注入以便测试.
export function runViewTransition(update: ViewTransitionUpdate, doc: Document = document): ViewTransitionLike {
  const capable = asCapable(doc);
  if (capable) {
    return capable.startViewTransition(update);
  }
  // Fallback shim: call update directly and wrap its result in the ViewTransitionLike shape.
  // 降级垫片: 直接调用 update 并将结果包装为 ViewTransitionLike 形状.
  //
  // WHY `.then(() => undefined)`: Promise<void> is compatible with Promise<unknown>, but
  // chaining normalises any resolved value to undefined, which matches the spec intent
  // and keeps TypeScript strict-mode happy without a cast.
  // `.then(() => undefined)` 原因: 链式调用将解析值规范为 undefined, 符合规范意图,
  // 且无需强制转换即可在严格模式下通过类型检查.
  const result = update();
  const finished = result instanceof Promise ? result.then(() => undefined) : Promise.resolve();
  return { finished };
}

// posterTransitionName — derives a stable, CSS-safe `view-transition-name` for a poster image.
// posterTransitionName — 为海报图生成稳定且符合 CSS 标识符规范的 `view-transition-name`.
//
// WHY sanitise: view-transition-name values must be valid CSS custom-ident tokens.
// Source keys and video IDs may contain dots, slashes, colons, or Unicode characters
// that are illegal in CSS identifiers.  The regex replaces every illegal character with
// an underscore, which is always legal.  The `poster-` prefix ensures the name never
// starts with a digit (also illegal in CSS idents).
// 清理原因: view-transition-name 值必须是合法的 CSS custom-ident 标记. source key 和
// video ID 可能含有点号、斜杠、冒号或 Unicode 字符, 均不符合 CSS 标识符规范.
// 正则将所有非法字符替换为下划线 (始终合法). `poster-` 前缀确保名称不以数字开头 (CSS ident 规范).
export function posterTransitionName(sourceKey: string, videoID: string): string {
  const safe = `${sourceKey}-${videoID}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `poster-${safe}`;
}
