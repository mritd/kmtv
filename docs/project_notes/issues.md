# Work Log

Completed and in-progress work, newest first. There is no issue tracker; entries name the branch instead of a ticket ID.

### 2026-10-06 - feat/ios-offline-downloads: iOS offline downloads (ADR-017)
- **Status**: Implemented on branch `feat/ios-offline-downloads`; ready for review.
- **Description**: The iOS app downloads HLS episodes through a background `URLSession` and plays them through a loopback media server. It opens in offline mode when the server is unreachable at launch. The server proxies `EXT-X-MAP`, `EXT-X-MEDIA`, `EXT-X-I-FRAME-STREAM-INF`, and `EXT-X-SESSION-KEY` URIs too.
- **Verification**: Full `KMTVTests` suite passed (346 tests at the last run, 2026-10-06), server tests passed, tvOS builds.
- **Simulator smoke check (2026-10-06, proxy mode)**: empty state, picker download through `/api/v1/proxy` with `mt` tokens, files and AES IVs on disk, local-first "Downloaded" label, offline launch with TS, fMP4, and AES playback through loopback, reconnect, zh-Hans strings; all passed.
- **Not verified on simulator**: direct mode, background and terminated downloads, token refresh, per-episode failure/retry/pause, auto-reconnect on network return.
- **Open before release**:
  - Device checks with `task device` on a real iPhone:
    - Queue 3 episodes on WiFi and lock the phone for 30 minutes; they complete.
    - Queue episodes, then force-quit from the app switcher; downloads resume on the next launch (iOS cancels background tasks on a force-quit).
    - Queue episodes and let iOS terminate KMTV under memory pressure (not a force-quit); downloads continue and the next launch shows them completed.
    - With `media_token_ttl` set to 2 minutes on a dev server, start a long episode; it refreshes and completes, and the log shows a second `/playback/url`.
    - Turn on airplane mode and launch; the app opens in offline mode and plays.
    - Trigger a background wake that must prepare several queued episodes; it persists and finishes within the time budget, and the rest continue on the next launch.
    - Play a local copy in the online player, lock the phone, then return; playback resumes from the loopback server.
    - With downloads running, scroll the Downloads screen and the player page; check the frame rate stays smooth.
    - Open the offline player while it loads and after it fails (for example with a missing file); the top-left close button dismisses it.
    - Play a downloaded episode; the system player shows the show title and episode name.
    - Pause and resume an episode in proxy mode; it keeps its progress. If it restarts at 0%, the `download playlist changed, restarting` log line names the mismatch.
- **Follow-ups**:
  - Media tokens stay valid after logout until they expire; needs a separate security change.
  - tvOS and Android have no downloads.
  - Spec deviations: see the deviations bullet of ADR-017 in `docs/ADR.md` (no aggregate speed, source-change notice logged only, system offline player controls, session identifier, retry count, percentage-only rows).
  - App-wide visual redesign.
  - ID-reuse window: `activate` resumes the previous user's `.signedOut` episodes before the first pull's `onScopeDropped`; resume them only after the scope's first successful pull.
  - Sweep orphan download directories at launch.
  - `LocalMediaServer.start()` is not reentrant.
  - The loopback server also serves `manifest.json`; restrict it to media file names.
- **Device feedback fixes (2026-10-06)**: download progress no longer re-renders whole screens per segment, offline scrubbing no longer saves per jump, and the offline player has one close button. Frame rate not re-measured on a device yet.
- **Adversarial review fixes (2026-10-06)**:
  - Parser: rejects `EXTINF` above one day (a crash) and non-http(s) URIs.
  - Writer: keeps a clear fMP4 init ahead of the key (it used to stall AVPlayer); covered by the `fmp4-aes-clearinit` fixture.
  - Local items that are not ready within 15 s fail, and the online player falls back to streaming.
  - Queue: refills past the 3000-task limit and merges in-flight claims across awaits.
  - Rows get progress on the throttled tick.
  - Offline scope is released on reconnect.
  - Transport: maps disk-full errors, adds a 60 s playlist resource timeout, logs loopback URLs without the secret.
  - Pause/resume restarts now log why (entry and line counts and the first differing entry).
  - Caveat: manifests saved before the fix have no map-encryption flag and keep the old rule. An episode already downloading from a MAP-before-KEY source still writes KEY before MAP; the load watchdog turns that into an error or fallback, and re-downloading fixes it.
- **Perf review fixes (2026-10-06)**:
  - Progress ticks and structural changes no longer read free space or fetch every row. Storage bytes follow row writes, and free space is read off the main actor on demand (every 20 s on the Downloads screen).
  - Prepare bumps the structure once per episode.
  - `canDownload` observes the preparer.
  - The offline player shows a close button while it has no player, debounces the paused state for the next-episode button, and caches the next episode.
  - Poster cache keys carry the show's revision.
  - The player page body no longer re-evaluates every second.

- **Notes**: Bugs found along the way are in `bugs.md` under 2026-10-06; ADR-017 in `docs/ADR.md`.

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
