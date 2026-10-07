# Architectural Decisions

The canonical decision log is [`docs/ADR.md`](../ADR.md). Record new decisions there, in its format, and add a one-line entry to this index. This file only points to the ADRs so they can be searched alongside the other project notes.

## Index

- ADR-001: Single Go binary with embedded static assets
- ADR-002: SQLite storage with a pure Go driver; migrations live in Go code under `server/internal/store`
- ADR-003: Public media proxy endpoints with URL-bound tokens
- ADR-004: Douban image proxy defaults to the Tencent CDN mirror
- ADR-005: Video source compatibility over strict typing
- ADR-006: Internal Base58 decoder for source config import
- ADR-007: No built-in default video source URL
- ADR-008: Native Apple clients for iOS and tvOS
- ADR-009: tvOS navigation avoids multi-level `NavigationStack`
- ADR-010: Exact web dependency versions and Bun builds
- ADR-011: Base58 opaque token authentication
- ADR-012: ArtPlayer for React web playback
- ADR-013: Detail route uses an opaque Base58 token path
- ADR-014: Frontend bilingual module headers and JSDoc documentation
- ADR-015: User-scoped watch history with ordered events (superseded by ADR-016)
- ADR-016: Unified offline-first sync for watch history, favorites, and search history
- ADR-017: iOS offline downloads through a background URLSession and a loopback media server
- ADR-018: Proxied playlists drop inserted ad runs (by segment directory), behind `ad_filter_enabled`
- ADR-020: The server serves one embedded default avatar and versioned avatar URLs; clients hide Remove when `avatar_is_default` (2026-10-07)

## Implementation choices under ADR-016 (2026-10-02)

Smaller choices made while building ADR-016. They follow from the ADR and the design spec and are not separate ADRs.

- Pull chains that start at `since = 0` send `full=1` so tombstone GC cannot reset them halfway; delta pulls never send it.
- Every reset that re-uploads local data first checks the stored username; a different username drops that scope's data.
- No migration of legacy client data: Web, Android, and Apple delete their old history storage, and Apple moves to `KMTV-sync-v1.store`.
- Android and Apple keep the engine idle on a server older than `v1.1.0`; `v0.0.0-dev` and an empty version count as new.
- The iOS app runs in a single window, so one sync store owns each scope.

## Implementation choices under ADR-017 (2026-10-06)

Smaller choices made while building ADR-017. They follow from the ADR and the design spec and are not separate ADRs.

- Episodes are identified per source by (source, video, episode index); the same title on another source is a separate download.
- Tokens refresh only on the media-token 401, at most 2 times per episode without progress.
- Preparation starts on `.inactive`, so playlists are fetched before the app is suspended.
- The delegate keeps tasks keyed by generation, so callbacks from cancelled tasks are ignored.
- Anonymous users (ID 0) have no downloads; the button is hidden.
- `LocalMediaServer.start()` retries the previous port and falls back to any port.
- A playback failure deletes a download only when files are missing (`filesIntact`).
- The offline player suspends on background and rebuilds at the checkpoint on return.
- The success toast has its own style (`ToastStyle`).
- Cover images retry on activate; `DownloadShow.coverURLString` stores the resolved URL.
