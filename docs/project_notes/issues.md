# Work Log

Completed and in-progress work, newest first. There is no issue tracker; entries name the branch instead of a ticket ID.

### 2026-10-07 - refactor/ios-split: split DownloadManager and PlayerViewModel, PlaybackEngine
- **Status**: Implemented on branch `refactor/ios-split`, ready for review; design in `docs/superpowers/specs/2026-10-07-ios-split-design.md`.
- **Description**: Behavior-preserving refactor of the two largest iOS types.
  - Downloads: `DownloadManager` stays the observable façade with the same API; `DownloadLibrary` (cross-scope read model and merge rules), `DownloadTaskLedger` (task claims and cancels), `EpisodeRuntime` (per-episode state, one `forget`), `DownloadCoverStore`, and `LocalPlaybackHost` are extracted; protocols and `LastIdentityStore` have their own files; `EpisodeKey` is computed only, so the persisted key and schema are unchanged.
  - Playback: `PlaybackEngine` is the only API the online and offline players use to drive playback, and `PlaybackCoordinator` the only conformer that touches `AVPlayer`; `PlaybackProgressTracker`, `SourceFallbackPolicy`, and `PlaybackTransportState` come out of `PlayerViewModel`; `FakePlaybackEngine` makes seek, skip, end, rate, and play/pause testable.
- **Verification (2026-10-07)**: `KMTVTests` 536/536 on the iPhone 17 Pro simulator; iOS and tvOS builds; `task bilingual-check`; screenshot tours on iPhone and iPad against the dev server, including offline playback of a download on iPad; a final review comparing old and new code found no behavior change (its low findings were fixed: cancel room timing, late seek completion test, close assertion).
- **Open items**:
  - Size targets missed: `DownloadManager.swift` about 1590 lines, `PlayerViewModel.swift` about 1170; going further needs a download engine extraction (pump, events) and moving open/switch out of the player view model.
  - The dev server had no video sources during the tours (`KMTV_INIT_SOURCE_URL` unset), so online search and streaming were covered only by tests.

### 2026-10-07 - fix/ios-review: iOS code review fixes
- **Status**: Implemented on branch `fix/ios-review`, ready for review.
- **Description**: A module-by-module review of the iOS code; fixes for the user-visible and lifecycle findings:
  - Session: every transition that leaves the session bumps an epoch that async results check; 401s count only for the current token; an expired saved token says the session expired; connect probes before replacing the old server, with real timeout and cancel; one `SyncStore` per scope.
  - Player: fetch-then-commit source switches guarded by a generation (also against the opening load); item callbacks carry their item; resume on appear only if it was playing; errors clear on recovery and tvOS gets a failure state; scrub API on the view model; `PlaybackProgressPolicy` shared by both players.
  - Browse and screens: cancellable searches that outlive the page, recoverable categories, first loads that survive tab switches; admin forms keep input on failure and roll back settings; confirmation before clearing watch history; shared downloads edit mode.
  - Downloads: serialized scope transitions (`beginDeactivate` queues at once); single-flight `LocalMediaServer.start()`; deletes through `Downloads/.trash`; a malformed IV fails the playlist; one `KMTVProxyURL` rule; storage is one `usedBytes`.
  - Sync: ports web's start waiters, an `online` trigger, visible SwiftData failures, and stored-row validation; `resetForServerLoss` matches web.
- **Verification (2026-10-07)**: `KMTVTests` 475/475 on the iPhone 17 Pro simulator; iOS and tvOS builds; `task bilingual-check`; screenshot tours against the dev server on iPhone (anonymous, including search and playback) and iPad (including downloads swipe and edit mode); a final adversarial review whose 8 findings were fixed.
- **Open items**:
  - Structural refactors left for a later phase: split `DownloadManager` and `PlayerViewModel`, a `PlaybackEngine` protocol, tvOS design tokens, shared poster grid and badges, cross-module duplication.
  - Not checked on a device: fullscreen playback rate sync, `LocalMediaServer` restarts across background and foreground.

### 2026-10-07 - feat/ios-redesign: iOS redesign, themes, offline entry, default avatar (ADR-019, ADR-020)
- **Status**: Implemented on branch `feat/ios-redesign`, ready for review; spec in `docs/superpowers/specs/2026-10-06-ios-redesign-design.md`.
- **Description**:
  - iOS screens rebuilt on design tokens with five accent themes and a System/Light/Dark switch; new categories browser, player page, downloads, profile, and admin layouts. tvOS look unchanged.
  - Offline viewing works without login or network for any known identity (ADR-017 amendment); the download header plays from the saved position (`DownloadResumePicker`).
  - Refused covers fall back to `CoverRegistry`, and URLs refused with 403/404/410 are remembered so they are not retried.
  - The server serves a default animated avatar and versioned avatar URLs (ADR-020); iOS, Web, and Android hide Remove for it, and Web loads avatars with the bearer header.
  - Admin settings: "Ad Filter" sits with the other toggles; token TTL pickers list the stored value even when it is not a preset.
  - Downloads are one device library whatever server or account made them, visible signed in, anonymous, and offline (ADR-017 amendment 2026-10-07).
  - A rejected saved token at launch says the session expired instead of "anonymous access is disabled".
  - iPad (regular width): media tabs scale posters, grids, and the hero (`MediaMetrics`); the home hero shows the poster on its blurred backdrop; categories use compact capsules; search shows two columns; the player puts episodes and settings in a right sidebar from 1000 pt wide; the download picker is a full form sheet; the hero shows the Douban synopsis (`desc` from `/douban/home`, preferred as on Web); toasts sit at the bottom so they clear the top tab bar. Categories (iPhone and iPad) drop the spotlight card and the pinned filter bar, add a back-to-top button, and give the status bar a material once scrolled. Server: unfiltered Douban recommend requests sort by `U`. Tab roots drop large titles there (the top tab bar names the page); Me and Admin sit in a 720 pt column, Downloads is full width. Download lists keep a selection only in edit mode, since an iPad `List(selection:)` also selects rows outside it. A local copy shows the time bar fully buffered and no buffer badge.
- **Verification (2026-10-07)**: landscape screenshot tour on the iPad Pro 11-inch (M4) iOS 18.6 simulator; `KMTVTests` 401/401 on the iPhone 17 Pro simulator, `go test ./...` and `task lint`, Web 954 tests and `tsc`, Android 573 tests and `tsc`, tvOS build, dark-mode screenshot tour (`ScreenshotTourUITests`) including the region menu test.
- **Open items**:
  - Default avatar not yet seen end to end: the running dev server predates it; restart it from the worktree.
  - Light-mode tour, iPad portrait, iPad Split View widths, and large Dynamic Type not re-checked after the last fixes.
  - The full UI test suite was not run; it signs out the simulator session.
  - `errs.NoAvatar` (1103) is no longer returned.
  - 2026-10-07: `LocalMediaServerTests` and local playback failed with AVPlayer `-12746` and CoreAudio `-66680` (no default audio output) until both simulators were rebooted; afterwards 7/7 passed. The full `KMTVTests` suite was not rerun after the last iPad fixes.

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
- **Simulator feedback fixes (2026-10-06)**:
  - Resume no longer restarts episodes whose source moves its ads on every fetch; entries match by upstream identity (`DownloadManifest.remapping(onto:)`).
  - Proxied playlists drop inserted ads behind `ad_filter_enabled` (ADR-018); admin toggles on Web, Android, and Apple.
  - Task creation runs off the main thread, so queueing thousands of entries no longer freezes the UI; finished entries cost O(1) on the main actor.
  - The show header's "Continue" and "Download More" buttons keep their style in the List row and never wrap.
  - Favorites, watch history, and downloads keep the cover of the card the user tapped when the result has its title; a show without a saved poster takes the new cover on the next enqueue.
  - Verified: `KMTVTests` 372/372 on the iPhone 17 Pro simulator, `task test`, `task lint`, Web 951 and Android 571 tests, i18n and bilingual checks, tvOS build. Not yet re-measured: CPU during a long download, and pause/resume on a device.
  - Follow-ups: Web and Android still prefer the source cover; a re-enqueued or refreshed episode waits behind tasks already queued in `nsurlsessiond`.
- **Adversarial review fixes (2026-10-06)**:
  - Parser: rejects `EXTINF` above one day (a crash) and non-http(s) URIs.
  - Writer: keeps a clear fMP4 init ahead of the key (it used to stall AVPlayer); covered by the `fmp4-aes-clearinit` fixture.
  - Local items that are not ready within 15 s fail, and the online player falls back to streaming.
  - Queue: refills past the 3000-task limit and merges in-flight claims across awaits.
  - Rows get progress on the throttled tick.
  - Offline scope is released on reconnect.
  - Transport: maps disk-full errors, adds a 60 s playlist resource timeout, logs loopback URLs without the secret.
  - Pause/resume restarts now log why (entry and line counts and the first differing entry).
  - Caveat: manifests saved before the fix have no map-encryption flag. Since 2026-10-06 a resume adopts the fresh playlist's lines, which corrects them; an episode that completes without a resume still writes KEY before MAP, the load watchdog turns that into an error or fallback, and re-downloading fixes it.
  - Caveat: rows can show more progress than the manifest on disk (saved every 20 entries and on state changes), so after a crash the progress shown may rewind on relaunch. Display only; files and the saved manifest stay consistent.
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
