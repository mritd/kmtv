# Key Facts

Non-sensitive project facts that are looked up often. Never store passwords, tokens, keys, or other secrets here; the admin account and media token secrets stay out of version control.

### Server

- Binary: `kmtv`, built by `task build` (web assets embedded, ADR-001).
- Flags: `--listen` (default `:8080`), `--db-path` (default `kmtv.db`; `:memory:` or `KMTV_DB_PATH=:memory:` for an ephemeral database).
- API base path: `/api/v1`; contract in `docs/server_api.md` and `docs/server_api_cn.md`.
- Version comes from `git describe --tags --always --dirty`, falling back to `v0.0.0-dev`; clients read it from `GET /api/v1/settings`.

### Sync (ADR-016)

- Endpoints: `POST /api/v1/sync/push`, `GET /api/v1/sync/pull?since=&epoch=&limit=[&full=1]`.
- Kinds: `watch` (cap 200), `favorite` (cap 1000, rejects with `limit`), `search` (cap 50).
- Push limits: 200 changes per request, 256 KiB body on the server; clients batch at most 192 KiB.
- Pull page: 500 by default, at most 1000.
- Tombstones are purged after 90 days; purges raise the user's `min_rev`.
- Minimum server for Android and Apple sync: `v1.1.0`. Tag the server before releasing clients.
- Key normalization vectors shared by all codebases: `testdata/sync-key-vectors.json`.
- Shared Web/Android core: `web/src/sync/` copied byte for byte to `android/src/sync/` (guarded by `sharedFiles.test.ts`); Swift port in `apple/Shared/Sync/`.
- Local stores: Web localStorage `kmtv.sync.v1:<origin>:<userID>`; Android MMKV under the per-server namespace; Apple SwiftData store `KMTV-sync-v1.store`.

### Clients

- Web: `web/`, Bun, exact-pinned dependencies (ADR-010).
- Android: `android/`, React Native, Bun; Jest needs `--runInBand --forceExit` because of a known exit hang.
- Apple: `apple/`, XcodeGen source of truth `apple/project.yml`; partial Info.plists `apple/KMTV-Info.plist` (iOS) and `apple/KMTVTV-Info.plist` (tvOS) hold keys Xcode cannot generate.
- Bundle IDs: `com.mritd.kmtv.ios`, `com.mritd.kmtv.tv`.

### Checks

- Backend: `task test`, `task lint`.
- Web: `cd web && bun run test && bun run lint && bun run bilingual-check`.
- Android: `cd android && bun run lint && bun run test -- --runInBand --forceExit && bun run i18n-check && bun run bilingual-check`.
- Apple unit tests: `xcodebuild test -project apple/KMTV.xcodeproj -scheme KMTV -destination '<iOS simulator>' -only-testing:KMTVTests`.
- Repository-wide bilingual comments: `task bilingual-check`.
