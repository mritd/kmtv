// Package consts centralizes shared server constants.
// Package consts 集中管理服务端共享常量.
package consts

import "time"

const (
	// EnvInitSourceURL optionally seeds sources on first startup.
	// EnvInitSourceURL 可选地在首次启动时初始化视频源.
	EnvInitSourceURL = "KMTV_INIT_SOURCE_URL"

	// EnvPublicBaseURL overrides the public base URL used in generated proxy links.
	// EnvPublicBaseURL 覆盖生成代理链接时使用的外部访问根地址.
	EnvPublicBaseURL = "KMTV_PUBLIC_BASE_URL"

	// SettingPublicBaseURL is the DB setting key for generated public proxy links.
	// SettingPublicBaseURL 是生成公开代理链接使用的 DB 设置 key.
	SettingPublicBaseURL = "public_base_url"

	// SettingSiteName is the DB setting key for the display site name.
	// SettingSiteName 是站点显示名称的 DB 设置 key.
	SettingSiteName = "site_name"

	// SettingAnonymousAccess is the DB setting key for anonymous access.
	// SettingAnonymousAccess 是匿名访问开关的 DB 设置 key.
	SettingAnonymousAccess = "anonymous_access"

	// SettingHealthCheckInterval is the DB setting key for source health check interval.
	// SettingHealthCheckInterval 是视频源健康检查间隔的 DB 设置 key.
	SettingHealthCheckInterval = "health_check_interval"

	// SettingNSFWFilterEnabled is the DB setting key for site-wide NSFW content filtering.
	// SettingNSFWFilterEnabled 是全站 NSFW 内容过滤开关的 DB 设置 key.
	SettingNSFWFilterEnabled = "nsfw_filter_enabled"

	// SettingDoubanImageProxy is the DB setting key for Douban image proxy mode.
	// SettingDoubanImageProxy 是豆瓣图片代理模式的 DB 设置 key.
	SettingDoubanImageProxy = "douban_image_proxy"

	// SettingSearchConcurrency is the DB setting key for search concurrency.
	// SettingSearchConcurrency 是搜索并发数的 DB 设置 key.
	SettingSearchConcurrency = "search_concurrency"

	// SettingProbeConcurrency is the DB setting key for CDN probe concurrency.
	// SettingProbeConcurrency 是 CDN 探测并发数的 DB 设置 key.
	SettingProbeConcurrency = "probe_concurrency"

	// SettingProbeTimeout is the DB setting key for CDN probe timeout in seconds.
	// SettingProbeTimeout 是 CDN 探测超时时间的 DB 设置 key, 单位秒.
	SettingProbeTimeout = "probe_timeout"

	// SettingSearchTimeout is the DB setting key for per-source search timeout in seconds.
	// SettingSearchTimeout 是单视频源搜索超时时间的 DB 设置 key, 单位秒.
	SettingSearchTimeout = "search_timeout"

	// SettingAccessTokenTTL is the DB setting key for access token TTL in seconds.
	// SettingAccessTokenTTL 是 access token 有效期设置 key, 单位秒.
	SettingAccessTokenTTL = "access_token_ttl"

	// SettingMediaTokenTTL is the DB setting key for media token TTL in seconds.
	// SettingMediaTokenTTL 是 media token 有效期设置 key, 单位秒.
	SettingMediaTokenTTL = "media_token_ttl"

	// SettingPlaybackMode is the DB setting key for playback mode.
	// SettingPlaybackMode 是播放模式设置 key.
	SettingPlaybackMode = "playback_mode"

	// DefaultAccessTokenTTL is the default access token TTL in seconds.
	// DefaultAccessTokenTTL 是默认 access token 有效期, 单位秒.
	DefaultAccessTokenTTL int64 = 7 * 24 * 3600

	// DefaultMediaTokenTTL is the default media token TTL in seconds.
	// DefaultMediaTokenTTL 是默认 media token 有效期, 单位秒.
	DefaultMediaTokenTTL int64 = 6 * 60 * 60

	// PlaybackModeProxy proxies media through KMTV.
	// PlaybackModeProxy 表示通过 KMTV 代理媒体.
	PlaybackModeProxy = "proxy"

	// PlaybackModeDirect returns upstream media URLs directly.
	// PlaybackModeDirect 表示直接返回上游媒体 URL.
	PlaybackModeDirect = "direct"

	// DefaultSearchConcurrency is the default max number of concurrent source searches.
	// DefaultSearchConcurrency 是默认视频源搜索并发数.
	DefaultSearchConcurrency = 20

	// DefaultProbeConcurrency is the default max number of concurrent CDN probes.
	// DefaultProbeConcurrency 是默认 CDN 探测并发数.
	DefaultProbeConcurrency = 20

	// DefaultProbeTimeout is the default CDN probe timeout in seconds.
	// DefaultProbeTimeout 是默认 CDN 探测超时时间, 单位秒.
	DefaultProbeTimeout = 3

	// DefaultSearchTimeout is the default per-source search timeout in seconds.
	// DefaultSearchTimeout 是默认单视频源搜索超时时间, 单位秒.
	DefaultSearchTimeout = 10

	// ProbeCacheTTL controls how long CDN probe results stay cached.
	// ProbeCacheTTL 控制 CDN 探测结果缓存时间.
	ProbeCacheTTL = 10 * time.Minute

	// AnonAccessCacheTTL controls how long anonymous_access stays cached.
	// AnonAccessCacheTTL 控制 anonymous_access 设置缓存时间.
	AnonAccessCacheTTL = 30 * time.Second

	// VideoSourceBodyLimit caps compatible video-source API response bodies.
	// VideoSourceBodyLimit 限制兼容视频源 API 响应体大小.
	VideoSourceBodyLimit int64 = 2 << 20

	// DefaultUserAgent is used for upstream media and Douban-compatible requests.
	// DefaultUserAgent 用于上游媒体和豆瓣兼容请求.
	DefaultUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"

	// HealthHealthy marks a source as reachable.
	// HealthHealthy 表示视频源可访问.
	HealthHealthy = "healthy"

	// HealthUnhealthy marks a source as currently unreachable.
	// HealthUnhealthy 表示视频源当前不可访问.
	HealthUnhealthy = "unhealthy"

	// HealthUnknown is the initial source health before probing.
	// HealthUnknown 表示视频源尚未探测的初始健康状态.
	HealthUnknown = "unknown"

	// HealthChecking marks a source whose probe is currently in flight.
	// HealthChecking 表示视频源探测正在进行中.
	HealthChecking = "checking"
)
