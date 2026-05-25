# Architectural Decisions

Durable architectural decisions for the KMTV Go backend, native Apple clients, and React browser client. Each entry records the context, decision, and consequences so future contributors can understand why the code is shaped the way it is.

## ADR-001: Single Go Binary With Embedded Static Assets

**Context:**
- KMTV is designed to be simple to deploy for self-hosted use.
- The backend serves API routes and static assets from a single process.

**Decision:**
- Keep the single-binary deployment model.
- Embed the built React browser-client assets into the Go binary via `embed.FS`.

**Consequences:**
- Deployment is one binary plus one SQLite DB file.
- Browser-client changes require a backend rebuild.

## ADR-002: SQLite Storage With Pure Go Driver

**Context:**
- KMTV targets small self-hosted deployments where external database setup is friction.

**Decision:**
- Use SQLite via `modernc.org/sqlite` (no CGO).
- Keep schema migrations in Go code under `server/internal/store`.

**Consequences:**
- No CGO dependency; cross-compilation stays simple.
- Backups are plain DB file copies.
- Write scaling is limited but acceptable for the target deployment shape.

## ADR-003: Public Media Proxy Endpoints With URL-Bound Tokens

**Context:**
- AVPlayer / AppleCoreMedia do not share the app's HTTP cookie or header storage.
- App-session-protected M3U8, segment, or key requests fail even when the app itself is authenticated.

**Decision:**
- Keep `/api/v1/proxy/m3u8`, `/api/v1/proxy/segment`, and `/api/v1/proxy/key` accessible without API bearer headers.
- Require URL-bound media tokens through the `mt` query parameter for M3U8, segment, and key proxy requests (see ADR-009).

**Consequences:**
- Native playback works reliably.
- Proxy endpoint security is enforced through SSRF-safe fetch logic, URL validation, and short-lived media tokens.

## ADR-004: Douban Image Proxy Defaults To Tencent CDN Mirror

**Context:**
- The Tencent CDN mirror delivers lower latency than the backend proxy for most deployments.
- Some Douban image subdomains trigger anti-crawl behavior when fetched server-side.

**Decision:**
- Default Douban image loading to the Tencent CDN mirror mode (`tencent`) for fresh databases.
- Server-side proxy mode remains available as a fallback for deployments where the Tencent CDN is blocked.
- Normalize `img\d+.doubanio.com` hosts to `img2.doubanio.com` when the server proxy fallback is used.
- Use browser-like request headers when the server proxy fallback is used.

**Consequences:**
- Cover image rendering is faster for the common case.
- Operators can switch via the `douban_image_proxy` setting; existing installations are not auto-migrated.

## ADR-005: Video Source Compatibility Over Strict Typing

**Context:**
- Video-source compatible APIs are inconsistent across source sites.
- Numeric fields and IDs may appear as either strings or numbers.

**Decision:**
- Decode unstable fields such as `page`, `limit`, `total`, `pagecount`, and `vod_id` as flexible values.
- Convert IDs through `model.FormatID`.
- Treat plain-text unsupported-search responses as source capability signals.

**Consequences:**
- Search and detail logic tolerates more source variants.
- Tests must cover mixed string/number response shapes.

## ADR-006: Internal Base58 Decoder For Source Config Import

**Context:**
- Source config subscriptions may be base58-encoded JSON.
- Pulling in a large dependency for one decoder is unnecessary.

**Decision:**
- Keep the internal `server/internal/base58` package as the sole decoder.

**Consequences:**
- Config import remains self-contained.
- If import formats diversify, revisit whether a shared parser abstraction is needed.

## ADR-007: No Built-In Default Video Source URL

**Context:**
- Bundling a third-party source subscription URL creates copyright and maintenance risk.
- Operators still need a convenient first-start bootstrap path.

**Decision:**
- Do not ship a built-in default video-source subscription URL.
- On a fresh DB, seed initial sources only when `KMTV_INIT_SOURCE_URL` is set.
- When that env var is set, import sources and create an auto-update subscription with interval `86400`.

**Consequences:**
- Clean installs do not contact or store a third-party default URL unless the operator opts in.
- Operators can reproduce the old bootstrap behavior with one explicit environment variable.

## ADR-008: Native Apple Clients For iOS And tvOS

**Context:**
- iOS Safari fullscreen playback and route-state behavior were not good enough for the desired UX.
- tvOS has no embedded browser view, making a browser-shell approach incomplete.

**Decision:**
- Maintain native SwiftUI clients for iOS and tvOS under `apple/`.
- Use shared Swift API models, storage, view models, and playback wrappers where practical.
- Use AVKit for HLS playback instead of custom video controls.

**Consequences:**
- Playback integrates with system controls and gestures.
- UI work must respect platform-specific SwiftUI behavior, especially on tvOS.

## ADR-009: tvOS Navigation Avoids Multi-Level NavigationStack

**Context:**
- tvOS `NavigationStack` inside `TabView` caused Menu-button and tab-bar state problems during multi-level pushes.

**Decision:**
- Avoid multi-level `NavigationStack` push flows on tvOS.
- Use tab switching and `fullScreenCover` for detail/player flows.

**Consequences:**
- tvOS navigation is more reliable.
- Shared views must keep platform-specific navigation wrappers small and explicit.

## ADR-010: Exact Web Dependency Versions And Bun Builds

**Context:**
- Web dependency ranges silently resolve to newer package versions.
- Silent upgrades increase supply-chain poisoning risk.

**Decision:**
- All web project builds use `bun`.
- Direct web dependencies in `package.json` must use exact pinned versions (e.g. `"pkg": "1.0.1"`).
- When adding dependencies, use `bun add pkg@1.0.1 --exact`.
- Version ranges such as `^1.0.0`, `~1.0.0`, `latest`, and wildcards are forbidden in direct dependencies.
- Transitive dependency versions are controlled by the committed Bun lockfile.

**Consequences:**
- Dependency updates must be explicit.
- Reviewers should reject new web dependency ranges that can auto-upgrade.

## ADR-011: Base58 Opaque Token Authentication

**Context:**
- Browser and native clients should not depend on HTTP-only session state.
- KMTV needs an auth model that works for API calls and AppleCoreMedia playback.
- Tokens must be copy-friendly and URL-friendly without escaping surprises.

**Decision:**
- Use base58 opaque bearer tokens for API auth.
- Store only token hashes in SQLite.
- Use URL-bound opaque media tokens for proxy playback.
- Default media token TTL is 30 minutes, configurable through `media_token_ttl`.

**Consequences:**
- Clients send API auth through `Authorization: Bearer <access_token>`.
- Logout and password changes revoke stored token rows.
- Proxy playback URLs remain usable by AppleCoreMedia because authorization lives in URL-bound media tokens.

## ADR-012: ArtPlayer For React Web Playback

**Context:**
- The React Web detail page needed stronger playback controls than the browser's native `<video controls>` UI.
- KMTV already resolves playback URLs through the backend and uses HLS proxy URLs, so the player should not change API or proxy behavior.

**Decision:**
- Use `artplayer@5.4.0` as the React Web playback UI shell.
- Keep `hls.js` for non-native HLS playback through ArtPlayer `customType.m3u8`.
- Preserve backend playback URL resolution and status handling in `PlaybackPanel`.

**Consequences:**
- Web playback gains custom controls, hotkeys, PiP, fullscreen, and web fullscreen without replacing the server media pipeline.
- Playback tests should mock the ArtPlayer boundary rather than starting the real browser player in unit tests.
- Browser autoplay policy can still block audible autoplay; the UI must keep a visible play path when autoplay is denied.

## ADR-013: Detail Route Uses Opaque Base58 Token Path

**Context:**
- The detail page route was `/detail/:source/:id`, which placed third-party source domains and provider video IDs directly into the visible URL.
- The exposed strings looked like KMTV was endorsing the third-party content and leaked source identity to address bars, browser history, share targets, and referrer headers.
- Real authorization is enforced by ADR-011 bearer tokens; the URL never carried any access control, only an identity hint.

**Decision:**
- Use `/detail/:token` where `token = base58(utf8(source_key + "\x1F" + video_id))`, encoded and decoded by `web/src/storage/detailRoute.ts`.
- Use base58 (Bitcoin/IPFS alphabet) — the same alphabet ADR-011 uses for backend bearer tokens.
- Decoding is part of the route boundary: `DetailPage` calls `decodeDetailToken` once and renders an "invalid token" state when the token is malformed.

**Consequences:**
- URLs no longer leak third-party domains or provider IDs.
- The encoding is reversible — anyone with a token can recover the underlying pair. This is cosmetic URL hygiene, not access control.
- Future detail-page navigators MUST use `detailRoutePath` rather than hand-building the path.

## ADR-014: Frontend Bilingual Module Headers And JSDoc Documentation

**Context:**
- The React browser client needs consistent module-level documentation across `web/src/`.
- Inconsistent comment styles lose institutional knowledge as the code evolves.

**Decision:**
- Every TypeScript file under `web/src/` carries a bilingual EN+CN block at the top describing responsibility, key exports, callers, and any ADR locks that apply.
- Every exported symbol carries a bilingual EN+CN JSDoc block immediately above its declaration. Internal helpers may use shorter line comments.
- Inline comments are reserved for non-obvious WHY (constraint, invariant, workaround); never narrate WHAT the code already says.
- Pure declaration files (`*.d.ts`) get a top-of-file module header only.
- Locale data maps (`src/i18n/locales/**`) are exempt — they are pure data, not code.
- Vitest-excluded modules must explain the exclusion rationale in their module header.
- `scripts/check-bilingual-comments.ts` recognises both line-comment and JSDoc-block bilingual styles.

**Consequences:**
- Contributors must preserve and extend, not strip, the documentation.
- Code review must reject PRs that introduce new exports without bilingual JSDoc.
- The coverage thresholds in `web/vitest.config.ts` must not be lowered without an ADR amendment.
