# KMTV

[中文](README.md) | [English](README_EN.md)

> A self-hosted video aggregation player with single-binary deployment and multi-client support (Web/iOS/tvOS).

**This project is developed for personal use. Please do not publish videos or articles promoting it on Bilibili, Xiaohongshu, WeChat Official Accounts, Douyin, or other mainland China social platforms.**
**This project does not authorize inclusion in any "tech weekly/monthly" style project or website, and does not accept sponsorship, paid custom development, or other commercial activity.**

<details>
<summary>Screenshots</summary>

  <img width="2560" height="1321" alt="1" src="https://github.com/user-attachments/assets/e49690c0-4931-4e83-af92-1fc5fae5e4f2" />
  <img width="2560" height="1150" alt="2" src="https://github.com/user-attachments/assets/12dc91c4-9b06-4ba5-9776-618a78d707e3" />
  <img width="2559" height="1002" alt="3" src="https://github.com/user-attachments/assets/5bbd4188-1290-44f4-b594-d7c1694d6ff2" />
  <img width="2560" height="1294" alt="4" src="https://github.com/user-attachments/assets/f3eaf097-7af4-497f-94f6-1ad3f2587869" />
  <img width="568" height="1084" alt="5" src="https://github.com/user-attachments/assets/4e31c7c5-636c-42d5-9361-897bdf335318" />
  <img width="1118" height="886" alt="6" src="https://github.com/user-attachments/assets/9c6d2e1e-682b-499c-9238-195619f20940" />

</details>

## Features

- Single-file deployment with a high-performance Go backend and embedded Web assets
- Backend proxy mode and frontend direct playback mode for flexible traffic routing and load requirements
- Parallel source probing for latency and availability to improve playback experience and reduce dead or unplayable sources
- Native iOS / tvOS clients (in development, Android may be supported later)
- Multi-user support with full permission management, anonymous access, NSFW source filtering, and per-user NSFW access control
- Source subscriptions with automatic updates, plus admin-panel controls for advanced server settings

Architecture decisions: [`docs/ADR.md`](docs/ADR.md). API contract: [`docs/server_api.md`](docs/server_api.md).

---

## Quick Start

### Server Docker Deployment (Recommended)

```bash
docker run -d --name kmtv \
  -p 8080:8080 \
  -v $PWD/data:/data \
  mritd/kmtv
```

Open `http://localhost:8080` in your browser. The default admin account is `admin` / `admin` (change it immediately after first login).

> Content notice: KMTV does not include, host, index, or recommend any video source. Operators must configure lawful sources themselves and ensure their usage complies with applicable copyright, licensing, and local legal requirements.

To import a source subscription on first startup, set `KMTV_INIT_SOURCE_URL`:

```bash
docker run -d --name kmtv \
  -p 8080:8080 \
  -v $PWD/data:/data \
  -e KMTV_INIT_SOURCE_URL="https://example.com/your-subscription" \
  mritd/kmtv
```

The source subscription URL should return a compatible JSON config. Example:

```json
{
  "cache_time": 3600,
  "api_site": {
    "alpha.example": {
      "name": "Alpha",
      "api": "https://alpha.example/api/provide/vod",
      "detail": "https://alpha.example",
      "_comment": "primary source"
    },
    "beta.example": {
      "name": "Beta",
      "api": "https://beta.example/api/provide/vod",
      "detail": "https://beta.example",
      "_comment": "backup source"
    }
  }
}
```

Each object key under `api_site` is stored as the source key. `name`, `api`, and `detail` are the display name, compatible API URL, and site homepage. `_comment` is an optional note field.

### Reverse Proxy / Public Deployment

```bash
docker run -d --name kmtv \
  -p 8080:8080 \
  -v $PWD/data:/data \
  -e KMTV_PUBLIC_BASE_URL="https://kmtv.example.com" \
  mritd/kmtv
```

You can also persist `public_base_url` from the admin Settings page.

---

## Build From Source

KMTV uses [`task`](https://taskfile.dev) to orchestrate build commands.

### Requirements

| Component | Version | Purpose                         |
|-----------|---------|---------------------------------|
| Go        | 1.26+   | Backend build                   |
| Bun       | 1.3+    | Web build and test              |
| Task      | 3+      | Task orchestration              |
| Xcode     | 16+     | iOS / tvOS clients (optional)   |
| XcodeGen  | 2.45+   | Generate Xcode project (optional) |

[`mise`](https://mise.jdx.dev/) is recommended for managing Go / Bun versions.

### Backend + Web Build

```bash
task build
# Output: server/kmtv (single binary with embedded web static assets)
```

Run:

```bash
./server/kmtv --listen :8080 --db-path ./kmtv.db
```

### Development Server

```bash
task server          # backend + embedded frontend, listens on :8080, uses ./dev.db
```

Standalone frontend dev server (hot reload):

```bash
task web:dev         # http://localhost:5173, proxies backend requests to :8080
```

### Web Client Only

```bash
task web:install     # bun install
task web:build       # bun run build, then copy output to server/web/dist
task web:test        # full vitest suite
task web:lint        # tsc --noEmit
```

### Backend Tests

```bash
task test            # go test ./... (with coverage)
task lint            # golangci-lint
```

### Docker Image Build

```bash
task docker          # local single-arch image build (buildx --load)
```

---

## Apple Client Build

Apple code lives under `apple/`, and the XcodeGen source is `apple/project.yml`.

### Configure Code Signing First

```bash
cp apple/Signing.example.xcconfig apple/Signing.local.xcconfig
# Edit apple/Signing.local.xcconfig and enter your Apple Developer Team ID
# This file is gitignored and will not be committed
```

### Generate / Regenerate Xcode Project

```bash
cd apple && xcodegen
```

### Simulator Run

```bash
task ios             # iPhone 16 Pro (iOS 18.6)
task ios26           # iPhone 17 Pro (iOS 26.1)
task ipad            # iPad Pro 11" M4 (iPadOS 18.6)
task ipad26          # iPad Pro 11" M5 (iPadOS 26.1)
task tv              # Apple TV (tvOS 18.5)
task tv26            # Apple TV (tvOS 26.2)
```

### Physical Device

```bash
task device          # detect online devices and install after unlock
```

### Apple UI Tests

UI tests connect to `http://localhost:8080` by default. For physical-device tests, point the environment variable to your Mac's LAN address:

```bash
KMTV_TEST_SERVER_URL=http://<mac-lan-ip>:8080 xcodebuild test ...
```

---

## Environment Variables

| Variable               | Description                                                                 |
|------------------------|-----------------------------------------------------------------------------|
| `KMTV_INIT_SOURCE_URL` | Source subscription URL imported on first startup; creates a 86400-second auto-update subscription |
| `KMTV_PUBLIC_BASE_URL` | Public external URL, higher priority than DB setting `public_base_url`       |
| `KMTV_TEST_SERVER_URL` | Backend URL for Apple UI tests, default `http://localhost:8080`              |

---

## Project Structure

```
.
├── server/                 # Go backend (Gin + SQLite)
│   ├── cmd/                # CLI entry
│   └── internal/
│       ├── handler/        # HTTP handlers
│       ├── middleware/     # auth / CORS / logging
│       ├── service/        # search / proxy / Douban / source sync
│       └── store/          # SQLite migrations and persistence
├── web/                    # React + Vite + TypeScript + Bun
├── apple/                  # iOS / tvOS SwiftUI clients
│   ├── Shared/             # cross-platform shared code
│   ├── KMTV/               # iOS app
│   ├── KMTVTV/             # tvOS app
│   └── project.yml         # XcodeGen project definition
├── scripts/                # simulator / physical-device scripts
├── docs/
│   ├── ADR.md              # architectural decision records
│   ├── server_api.md       # server API contract (EN)
│   └── server_api_cn.md    # server API contract (CN)
└── Taskfile.yml            # build task orchestration
```

---

## License

KMTV is released under the [MIT License](LICENSE).

Copyright (c) 2026 mritd.

Unless otherwise noted, all source code and documentation in this repository are licensed under the MIT License. The license text in [`LICENSE`](LICENSE) is the official license text for copying, modification, distribution, and sublicensing.

---

## Contributing

PRs are welcome. Before submitting, read [`AGENTS.md`](AGENTS.md) and [`docs/ADR.md`](docs/ADR.md), then verify your changes with:

```bash
task test web:test web:lint
```
