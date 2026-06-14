package service

import (
	"net/url"
	"sync"
	"time"

	"github.com/mritd/kmtv/internal/consts"
	appruntime "github.com/mritd/kmtv/internal/runtime"
)

// SetSearchConcurrency updates the max concurrent source searches (clamped to 1-50).
// SetSearchConcurrency 更新最大并发视频源搜索数量, 范围限制为 1-50.
func SetSearchConcurrency(n int) {
	appruntime.Default().SetSearchConcurrency(n)
}

// GetSearchConcurrency returns the current search concurrency limit.
// GetSearchConcurrency 返回当前搜索并发限制.
func GetSearchConcurrency() int {
	return appruntime.Default().SearchConcurrency()
}

// SetProbeConcurrency updates the max concurrent CDN probes (clamped to 1-50).
// SetProbeConcurrency 更新最大并发 CDN 探测数量, 范围限制为 1-50.
func SetProbeConcurrency(n int) {
	appruntime.Default().SetProbeConcurrency(n)
}

// GetProbeConcurrency returns the current probe concurrency limit.
// GetProbeConcurrency 返回当前探测并发限制.
func GetProbeConcurrency() int {
	return appruntime.Default().ProbeConcurrency()
}

// SetProbeTimeout updates the CDN probe timeout in seconds (clamped to 1-20).
// SetProbeTimeout 更新 CDN 探测超时时间, 单位秒, 范围限制为 1-20.
func SetProbeTimeout(n int) {
	appruntime.Default().SetProbeTimeout(n)
}

// GetProbeTimeout returns the current probe timeout as a time.Duration.
// GetProbeTimeout 返回当前探测超时时间.
func GetProbeTimeout() time.Duration {
	return appruntime.Default().ProbeTimeout()
}

// SetSearchTimeout updates the per-source search timeout in seconds (clamped to 1-30).
// SetSearchTimeout 更新单视频源搜索超时时间, 单位秒, 范围限制为 1-30.
func SetSearchTimeout(n int) {
	appruntime.Default().SetSearchTimeout(n)
}

// GetSearchTimeout returns the current search timeout as a time.Duration.
// GetSearchTimeout 返回当前搜索超时时间.
func GetSearchTimeout() time.Duration {
	return appruntime.Default().SearchTimeout()
}

// --- CDN probe cache (URL -> result + expiry) ---
// --- CDN 探测缓存, URL -> 结果和过期时间 ---

type probeCacheEntry struct {
	alive   bool
	expires time.Time
}

var probeCache struct {
	sync.RWMutex
	m map[string]probeCacheEntry // normalized media URL -> entry
}

func init() {
	probeCache.m = make(map[string]probeCacheEntry)
}

// probeCacheKey returns the normalized cache key for a probe URL.
// probeCacheKey 返回探测 URL 的规范化缓存 key.
func probeCacheKey(rawURL string) (string, bool) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", false
	}
	u.Fragment = ""
	return u.String(), true
}

// probeCacheGet looks up the cached probe result for the concrete media URL.
// Returns (alive, true) on cache hit, (false, false) on miss.
// probeCacheGet 查询具体媒体 URL 的缓存探测结果.
// 命中时返回 (alive, true), 未命中时返回 (false, false).
func probeCacheGet(rawURL string) (alive bool, hit bool) {
	key, ok := probeCacheKey(rawURL)
	if !ok {
		return false, false
	}
	probeCache.RLock()
	entry, ok := probeCache.m[key]
	probeCache.RUnlock()
	if ok && time.Now().Before(entry.expires) {
		return entry.alive, true
	}
	return false, false
}

// probeCacheSet stores a probe result (alive or dead) for the concrete media URL.
// probeCacheSet 保存具体媒体 URL 的探测结果, 可用和不可用都会缓存.
func probeCacheSet(rawURL string, alive bool) {
	key, ok := probeCacheKey(rawURL)
	if !ok {
		return
	}
	probeCache.Lock()
	probeCache.m[key] = probeCacheEntry{alive: alive, expires: time.Now().Add(consts.ProbeCacheTTL)}
	probeCache.Unlock()
}
