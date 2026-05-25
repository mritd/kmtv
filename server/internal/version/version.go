// Package version exposes build metadata injected at link time via -ldflags.
// Package version 暴露通过 -ldflags 在链接期注入的构建元信息.
//
// The three exported variables are overridden at build time with
// `go build -ldflags "-X github.com/mritd/kmtv/internal/version.Version=..."`.
// When built without those flags (e.g. `go test`, `go run`), they fall back to
// the development defaults declared here.
// 这三个导出变量在构建时通过
// `go build -ldflags "-X github.com/mritd/kmtv/internal/version.Version=..."` 覆盖.
// 未注入这些标志时 (例如 `go test`、`go run`), 它们回退到此处声明的开发默认值.
package version

import (
	"fmt"
	"runtime"
)

var (
	// versionTemplate Console Version Template
	// versionTemplate 控制台版本模板
	versionTemplate = `▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
██ █▀▄██ ▄▀▄ █▄▄ ▄▄██ ███ █
██ ▄▀███ █ █ ███ █████ █ ██
██ ██ ██ ███ ███ █████▄▀▄██
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

▶ Version: %s
▶ Platform: %s/%s
▶ Go Version: %s
▶ Build Time: %s
▶ Git Commit: %s`
	// Version is the semantic version or git tag of the build.
	// Version 是本次构建的语义化版本或 git tag.
	Version = "v0.0.0-dev"
	// GitCommit is the full git commit hash of the build.
	// GitCommit 是本次构建的完整 git commit hash.
	GitCommit = "unknown"
	// BuildTime is the RFC3339 UTC timestamp of the build.
	// BuildTime 是 RFC3339 格式的 UTC 构建时间.
	BuildTime = "unknown"
)

// Info returns a multi-line human-readable build summary for the --version flag.
// Info 返回供 --version 选项使用的多行可读构建摘要.
func Info() string {
	return fmt.Sprintf(versionTemplate, Version, runtime.GOOS, runtime.GOARCH, runtime.Version(), BuildTime, GitCommit)
}
