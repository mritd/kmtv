# Work Log

Completed and in-progress work, newest first. There is no issue tracker; entries name the branch instead of a ticket ID.

### 2026-10-03 - feat/unified-sync: Unified offline-first sync (ADR-016)
- **Status**: Implemented on branch `feat/unified-sync`, not merged.
- **Description**: Watch history, favorites, and search history sync across the server, Web, Android, iOS, and tvOS through `/api/v1/sync/push` and `/api/v1/sync/pull`, with offline-first local stores.
- **Notes**: A full-branch review found the bugs logged in `bugs.md` under 2026-10-02 and 2026-10-03; all are fixed, with tests.
- **Open before release**:
  - Tag the server `v1.1.0` before Android and Apple users update.
  - Manual end-to-end check on the iOS simulator and a real tvOS build (`task tv`), not run in development.
  - Android on-device check, not run in development.
- **Follow-ups**:
  - A late `401` from a request in flight at logout can return the next session to server setup (pre-existing for every API call).
  - Apple `switchSource` has no request token for its detail load, so rapid source switches can attach a stale source.
  - Tombstones for never-seen keys are unbounded per user; accepted for a private deployment.
