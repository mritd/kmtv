# KMTV Agent Instructions

Project-level instructions for coding agents working in this repository.

## Project Direction

- KMTV is a self-hosted video aggregation player.
- Active surfaces: Go backend, native Apple clients (iOS + tvOS), React browser client.

## Where Decisions Live

Architectural decisions are recorded in [`docs/ADR.md`](docs/ADR.md). Read it before proposing changes that touch authentication, storage, proxy endpoints, web dependencies, or platform-specific navigation. If a change conflicts with an ADR, acknowledge it and propose an amendment rather than silently diverging.

The full server API contract is in [`docs/server_api.md`](docs/server_api.md) (English) and [`docs/server_api_cn.md`](docs/server_api_cn.md) (Chinese).

## Build And Test

| Task                    | Command       |
|-------------------------|---------------|
| Full build              | `task build`  |
| Backend tests           | `task test`   |
| Backend lint            | `task lint`   |
| Backend dev server      | `task server` |
| Web tests               | `task web:test` |
| Web type-check          | `task web:lint` |
| Web build               | `task web:build` |
| iOS simulator           | `task ios`    |
| iOS 26 simulator        | `task ios26`  |
| iPad simulator          | `task ipad`   |
| iPadOS 26 simulator     | `task ipad26` |
| tvOS simulator          | `task tv`     |
| tvOS 26 simulator       | `task tv26`   |
| Physical device install | `task device` |
| Docker image            | `task docker` |

Use the smallest useful verification command for each change.

## Backend Rules

- Backend code lives under `server/`.
- API routes are registered under `/api/v1`.
- Keep media proxy endpoints (`/proxy/m3u8`, `/proxy/segment`, `/proxy/key`) public; access control lives in URL-bound `mt` media tokens (ADR-003).
- Run `gofmt` on changed Go files; use `task test` or `go test ./...` from `server/` for verification.
- SQLite migrations live in Go code under `server/internal/store` (ADR-002).
- Treat upstream video-source compatible responses as inconsistent and untrusted (ADR-005).

## Apple Client Rules

- Apple code lives under `apple/`.
- XcodeGen source of truth is `apple/project.yml`; regenerate the Xcode project when it changes.
- Shared Swift code lives under `apple/Shared/`.
- iOS and tvOS targets share API models and storage where practical; navigation is platform-specific.
- tvOS must avoid multi-level `NavigationStack` push flows inside `TabView` (ADR-009).
- AVPlayer media requests do not share app cookies, so playback URLs must encode authorization (ADR-011).

## Web Client Rules

- React browser client lives under `web/`.
- All web builds use `bun`; direct dependencies in `package.json` must be exact-pinned (ADR-010).
- Every TypeScript file under `web/src/` carries bilingual EN+CN module headers and JSDoc on exported symbols (ADR-014).
- Detail page navigation goes through `detailRoutePath` from `web/src/storage/detailRoute.ts`; never hand-build the `/detail/:token` path (ADR-013).

## Physical Device Workflow

- `task device` runs `./scripts/device.sh` from the repository root.
- Parse online devices from `xcrun xctrace list devices`; offline devices must not be selected as xcodebuild destinations.
- If device selection looks correct but build/install hangs, check pairing, unlock state, and device preparation before changing project configuration.
