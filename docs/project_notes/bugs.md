# Bug Log

Bugs worth remembering, newest first: what broke, why, how it was fixed, and how to avoid it again.
Keep entries short; remove entries that no longer teach anything.

### 2026-10-06 - Bootstrap timeout showed a cancel toast instead of "Connection timed out"
- **Issue**: With a hanging server, the app went to server setup with a cancel toast instead of "Connection timed out".
- **Root Cause**: The 5 s bootstrap timeout cancels the `me()` task, but `APIRequestExecutor` wraps `URLError.cancelled` as `APIError.networkError`, so `catch is CancellationError` never fired. Predates the downloads work.
- **Solution**: `AppViewModel.bootstrap` sets a `timedOut` flag and maps the failure to `URLError(.timedOut)`; `bootstrapTimeout` is injectable. Covered by `BootstrapOfflineTests`.
- **Prevention**: Errors from `APIClient` never surface as `CancellationError`; check for a wrapped `URLError.cancelled`.

### 2026-10-06 - HLS parser trapped on hostile playlists
- **Issue**: A hostile `EXT-X-MEDIA-SEQUENCE` (Int overflow) or non-finite `EXTINF` crashed the app. Found in review, fixed before merge.
- **Root Cause**: The parser converted untrusted numbers without range or finiteness checks (ADR-005).
- **Solution**: Such playlists now throw `.notHLS`.
- **Prevention**: Treat every number in an upstream playlist as untrusted; use checked arithmetic and `isFinite`.

### 2026-10-06 - Download pump started discretionary tasks in the background
- **Issue**: When a preparation finished after the app was backgrounded, the pump created discretionary background tasks. Found in review, fixed before merge.
- **Root Cause**: The foreground check ran once, before the awaits in the pump.
- **Solution**: The pump re-checks foreground after every await.
- **Prevention**: Re-check state that can change while suspended after each `await`.

### 2026-10-03 - Stray separator in Apple metadata lines
- **Issue**: Favorites, search results, the detail page, and the player showed lines like "| 2025" when the type, year, or area was empty.
- **Root Cause**: The views interpolated `"\(type) | \(year)"` directly; Web already dropped empty parts before joining.
- **Solution**: `DisplayFormatters.metaLine(_:separator:)` joins only non-empty parts; all five call sites use it. Verified with `testMetaLineSkipsEmptyParts`, the full `KMTVTests` suite (215), and a tvOS simulator build.
- **Prevention**: Build metadata lines with `DisplayFormatters.metaLine`, not string interpolation.

### 2026-10-03 - Web player gate opened early under StrictMode
- **Issue**: In `vite dev`, a player could pick its episode from stale local data before the launch sync.
- **Root Cause**: StrictMode replays effects (mount, unmount, mount); the provider's cleanup stopped the engine and the child gate's replayed effect saw a stopped engine and resolved at once.
- **Solution**: `SyncProvider` starts and stops the engine in `useLayoutEffect`, which runs before child passive effects, also on replay (`web/src/sync/SyncContext.tsx`).
- **Prevention**: Start or stop shared resources that children use on mount in a layout effect; test effect-order behavior under `<StrictMode>`.

### 2026-10-03 - App Transport Security setting never reached the Apple apps
- **Issue**: iOS and tvOS could not load plain-HTTP servers or media by host name (IP addresses and `.local` hosts are exempt, which hid it).
- **Root Cause**: `INFOPLIST_KEY_NSAppTransportSecurity_AllowsArbitraryLoads` is not a key Xcode generates; the built Info.plist had no ATS entry since the first commit.
- **Solution**: Put `NSAppTransportSecurity` in the partial plists `apple/KMTV-Info.plist` and `apple/KMTVTV-Info.plist`, merged with the generated keys.
- **Prevention**: After changing Info.plist build settings, check the built app with `plutil -p <App>.app/Info.plist`.

### 2026-10-02 - Full sync never finished for accounts with many old rows
- **Issue**: A new or long-offline device kept failing with "sync pull asked for a reset twice" and only saw the oldest 500 items.
- **Root Cause**: The server applied the `since < min_rev` reset to every page, including later pages of a pull chain that started at `since = 0`.
- **Solution**: Clients send `full=1` on every page of a chain from 0 and the server skips the floor check for it; the last page reports the user's current rev.
- **Prevention**: Paginated protocols need tests with more than one page; the store tests now page past `min_rev` with a small limit.

### 2026-10-02 - Same-epoch restore re-uploaded another user's data
- **Issue**: After a restore from an older backup, a new account reusing an old user ID could receive the previous user's favorites and history from a shared device.
- **Root Cause**: The `rev < cursor` reset branch re-uploaded local data without the username check the epoch-reset branch had.
- **Solution**: One helper, `resetForServerLoss`, handles both branches on Web/Android and Apple; a different stored username drops the scope's data.
- **Prevention**: Every reset path that re-uploads data must check that the data belongs to the current username.

### 2026-10-02 - Outgoing playback position written under the new episode
- **Issue**: A checkpoint during a source, line, or episode switch could save the old item's time under the new selection, marking unwatched finales finished or skipping episodes on every device.
- **Root Cause**: Android kept `currentTime`/`duration` across switches; Apple's outgoing AVPlayer item kept reporting time until the new item attached.
- **Solution**: Android resets the time on every switch; Apple detaches the outgoing item until `startPlayer` and ignores stale playback URL replies through a request token.
- **Prevention**: Test a checkpoint between a switch and the new item's first progress event.

### 2026-10-02 - iPad multi-window ran two sync stores on one scope
- **Issue**: Two iPad windows overwrote each other's pending clears and wrote to deleted SwiftData rows.
- **Root Cause**: Each window built its own `AppViewModel` and `SyncSession` over the same rows.
- **Solution**: The iOS app disables multiple scenes (`UIApplicationSupportsMultipleScenes = false` in `apple/KMTV-Info.plist`).
- **Prevention**: One sync store per scope per process; revisit before enabling multiple windows again.

### 2026-10-02 - Restored Web player started from 0 and overwrote progress
- **Issue**: Reopening a detail page in the same tab played from 0, then a checkpoint overwrote the saved position.
- **Root Cause**: A player restored from the detail cache consumed its one-shot initial seek while `useWatchResume` was still pending and hid the local record.
- **Solution**: The initial position comes from the local watch record; the exact-match rule still guards it.
- **Prevention**: Any one-shot seek must have its data before the player mounts.

### 2026-10-02 - Chinese doc comment line starting with code failed the bilingual check
- **Issue**: `task bilingual-check` reported a missing separator in `PlaybackProgressStore.swift`.
- **Root Cause**: A wrapped Chinese line began with a backtick identifier, which the checker reads as a new English paragraph.
- **Solution**: Rewrapped the line so it starts with Chinese text.
- **Prevention**: Run `task bilingual-check` before committing; do not start a wrapped Chinese line with code.
