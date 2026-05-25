# KMTV

[中文](README.md) | [English](README_EN.md)

> 自托管视频聚合播放器, 单二进制部署, 多端支持(Web/iOS/tvOS).

**本项目为个人使用开发, 请不要在 B站、小红书、微信公众号、抖音、等其他中国大陆社交平台发布视频或文章宣传本项目**
**本项目不授权任何 "科技周刊/月刊" 类项目或站点收录, 不接受任何赞助以及付费二次开发等商业化行为.**

<details>
<summary>截图预览</summary>

  <img width="2560" height="1321" alt="1" src="https://github.com/user-attachments/assets/e49690c0-4931-4e83-af92-1fc5fae5e4f2" />
  <img width="2560" height="1150" alt="2" src="https://github.com/user-attachments/assets/12dc91c4-9b06-4ba5-9776-618a78d707e3" />
  <img width="2559" height="1002" alt="3" src="https://github.com/user-attachments/assets/5bbd4188-1290-44f4-b594-d7c1694d6ff2" />
  <img width="2560" height="1294" alt="4" src="https://github.com/user-attachments/assets/f3eaf097-7af4-497f-94f6-1ad3f2587869" />
  <img width="568" height="1084" alt="5" src="https://github.com/user-attachments/assets/4e31c7c5-636c-42d5-9361-897bdf335318" />
  <img width="1118" height="886" alt="6" src="https://github.com/user-attachments/assets/9c6d2e1e-682b-499c-9238-195619f20940" />

  
</details>

## 特性

- 单文件部署, 高性能 Go 后端 + 内嵌 Web 资源
- 后端代理与前端直连双播放模式, 代理友好
- 并行源探测延迟与可用性, 最大化优化播放体验
- 原生 iOS / tvOS 客户端(开发中, 后续可能支持 Android)
- 多用户支持, 完善的权限管理机制, 支持匿名访问

架构决策见 [`docs/ADR.md`](docs/ADR.md), API 契约见 [`docs/server_api.md`](docs/server_api.md).

---

## 快速开始

### 服务端 Docker 部署(推荐)

```bash
docker run -d --name kmtv \
  -p 8080:8080 \
  -v $PWD/data:/data \
  mritd/kmtv
```

浏览器访问 `http://localhost:8080`, 默认管理员账号 `admin` / `admin`(首次登录后请立即修改).

> 内容声明: KMTV 不内置, 不托管, 不索引, 不推荐任何视频源. 部署者需要自行配置合法来源, 并自行确保其使用方式符合适用的版权, 授权协议及当地法律法规要求.

如果期望首次启动时自动导入源订阅, 可使用 `KMTV_INIT_SOURCE_URL` 变量:

```bash
docker run -d --name kmtv \
  -p 8080:8080 \
  -v $PWD/data:/data \
  -e KMTV_INIT_SOURCE_URL="https://example.com/your-subscription" \
  mritd/kmtv
```

源订阅 URL 应返回兼容的 JSON 配置, 格式示例:

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

`api_site` 下的对象 key 会作为视频源 key 写入数据库. `name`, `api`, `detail` 分别表示显示名称, 兼容 API 地址和站点首页. `_comment` 为可选备注字段.

### 反向代理 / 公网部署

```bash
docker run -d --name kmtv \
  -p 8080:8080 \
  -v $PWD/data:/data \
  -e KMTV_PUBLIC_BASE_URL="https://kmtv.example.com" \
  mritd/kmtv
```

也可在管理后台的 Settings 中设置 `public_base_url` 持久化.

---

## 从源码构建

KMTV 使用 [`task`](https://taskfile.dev) 统一编排构建命令.

### 环境依赖

| 组件     | 版本  | 用途                    |
|----------|-------|-------------------------|
| Go       | 1.26+ | 后端编译                |
| Bun      | 1.3+  | Web 构建与测试          |
| Task     | 3+    | 任务编排                |
| Xcode    | 16+   | iOS / tvOS 客户端(可选)|
| XcodeGen | 2.45+ | 生成 Xcode 工程(可选) |

推荐用 [`mise`](https://mise.jdx.dev/) 管理 Go / Bun 版本.

### 后端 + Web 一次性构建

```bash
task build
# 产物:server/kmtv(单二进制, 已内嵌 web 静态资源)
```

运行:

```bash
./server/kmtv --listen :8080 --db-path ./kmtv.db
```

### 开发服务器

```bash
task server          # 后端 + 内嵌前端,监听 :8080,dev.db 落本目录
```

前端独立 dev server(热重载):

```bash
task web:dev         # http://localhost:5173,后端走 :8080 代理
```

### Web 客户端单独构建

```bash
task web:install     # bun install
task web:build       # bun run build,产物拷贝到 server/web/dist
task web:test        # vitest 全量
task web:lint        # tsc --noEmit
```

### 后端测试

```bash
task test            # go test ./...(含覆盖率)
task lint            # golangci-lint
```

### Docker 镜像构建

```bash
task docker          # 本地构建单架构镜像 (buildx --load)
```

---

## Apple 客户端构建

代码位于 `apple/`, XcodeGen 源为 `apple/project.yml`.

### 首次配置代码签名

```bash
cp apple/Signing.example.xcconfig apple/Signing.local.xcconfig
# 编辑 apple/Signing.local.xcconfig, 填入你的 Apple Developer Team ID
# 该文件已 gitignore, 不会被提交
```

### 生成 / 重新生成 Xcode 工程

```bash
cd apple && xcodegen
```

### 模拟器运行

```bash
task ios             # iPhone 16 Pro (iOS 18.6)
task ios26           # iPhone 17 Pro (iOS 26.1)
task ipad            # iPad Pro 11" M4 (iPadOS 18.6)
task ipad26          # iPad Pro 11" M5 (iPadOS 26.1)
task tv              # Apple TV (tvOS 18.5)
task tv26            # Apple TV (tvOS 26.2)
```

### 物理设备

```bash
task device          # 自动检测在线设备, 解锁后自动安装
```

### Apple UI 测试

UI 测试默认连接 `http://localhost:8080`. 在物理设备测试场景下, 通过环境变量指向 Mac 的局域网地址:

```bash
KMTV_TEST_SERVER_URL=http://<mac-lan-ip>:8080 xcodebuild test ...
```

---

## 环境变量

| 变量                   | 说明                                                           |
|------------------------|----------------------------------------------------------------|
| `KMTV_INIT_SOURCE_URL` | 首次启动时导入的源订阅 URL, 自动建立 86400 秒间隔的更新订阅    |
| `KMTV_PUBLIC_BASE_URL` | 对外公开访问地址, 优先级高于 DB 设置 `public_base_url`         |
| `KMTV_TEST_SERVER_URL` | Apple UI 测试连接的后端地址, 默认 `http://localhost:8080`      |

---

## 项目结构

```
.
├── server/                 # Go 后端 (Gin + SQLite)
│   ├── cmd/                # CLI 入口
│   └── internal/
│       ├── handler/        # HTTP 处理器
│       ├── middleware/     # 鉴权 / CORS / 日志
│       ├── service/        # 搜索 / 代理 / 豆瓣 / 源同步
│       └── store/          # SQLite 迁移与持久化
├── web/                    # React + Vite + TypeScript + Bun
├── apple/                  # iOS / tvOS SwiftUI 客户端
│   ├── Shared/             # 跨平台共享代码
│   ├── KMTV/               # iOS app
│   ├── KMTVTV/             # tvOS app
│   └── project.yml         # XcodeGen 工程定义
├── scripts/                # 模拟器 / 物理设备脚本
├── docs/
│   ├── ADR.md              # 架构决策记录
│   ├── server_api.md       # 服务端 API 契约 (EN)
│   └── server_api_cn.md    # 服务端 API 契约 (CN)
└── Taskfile.yml            # 构建任务编排
```

---

## License

KMTV 基于 [MIT License](LICENSE) 开源发布.

Copyright (c) 2026 mritd.

除非另有说明, 本仓库中的所有源代码和文档均按 MIT License 授权. [`LICENSE`](LICENSE) 文件中的许可证正文是本项目复制, 修改, 分发及再授权时的正式授权文本.

---

## 贡献

欢迎 PR .提交前请阅读 [`AGENTS.md`](AGENTS.md) 与 [`docs/ADR.md`](docs/ADR.md), 并通过构建任务验证:

```bash
task test web:test web:lint
```
