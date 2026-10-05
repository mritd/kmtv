# Work Log

Completed and in-progress work, newest first. There is no issue tracker; entries name the branch instead of a ticket ID.

### 2026-10-03 - fix/apple-meta-separator: Drop empty parts from Apple metadata lines
- **Status**: Fixed on branch `fix/apple-meta-separator`.
- **Description**: Favorites, search, detail, and player metadata lines no longer show a stray "|" when a value is empty.
- **Notes**: `KMTVTests` 215/215 and the tvOS simulator build pass; see `bugs.md` 2026-10-03.

### 2026-10-03 - feat/unified-sync: Unified offline-first sync (ADR-016)
- **Status**: Merged to `main` through PR #2 (https://github.com/mritd/kmtv/pull/2).
- **Description**: Watch history, favorites, and search history sync across the server, Web, Android, iOS, and tvOS through `/api/v1/sync/push` and `/api/v1/sync/pull`, with offline-first local stores.
- **Notes**: A full-branch review found the bugs logged in `bugs.md` under 2026-10-02 and 2026-10-03; all are fixed, with tests.
- **Open before release**:
  - Tag the server `v1.1.0` before Android and Apple users update.
  - Manual end-to-end check on tvOS (`task tv`). iPhone and iPad sync was checked on the iOS 26.5 simulators on 2026-10-03 (seeded favorites, continue watching, and search history appeared; a search clear reached the server and the other device), and the tvOS simulator build passes since 2026-10-03.
  - Android on-device check, not run in development.
- **Follow-ups**:
  - A late `401` from a request in flight at logout can return the next session to server setup (pre-existing for every API call).
  - Apple `switchSource` has no request token for its detail load, so rapid source switches can attach a stale source.
  - Tombstones for never-seen keys are unbounded per user; accepted for a private deployment.
