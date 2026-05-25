package model

import (
	"fmt"
	"time"
)

// FormatID converts a JSON-decoded any value, usually float64 or string, to a string ID.
// FormatID 将 JSON 解析得到的 any 值, 通常是 float64 或 string, 转成字符串 ID.
func FormatID(v any) string {
	switch id := v.(type) {
	case float64:
		return fmt.Sprintf("%.0f", id)
	case string:
		return id
	default:
		return fmt.Sprintf("%v", v)
	}
}

// User represents a system user.
// User 表示系统用户.
type User struct {
	ID                int64     `json:"id"`
	Username          string    `json:"username"`
	Password          string    `json:"-"`
	Avatar            string    `json:"-"`
	Role              string    `json:"role"` // admin, user
	AllowAdultContent bool      `json:"allow_adult_content"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// Source represents a video source endpoint.
// Source 表示视频源端点.
type Source struct {
	ID         int64     `json:"id"`
	Key        string    `json:"key"`    // domain, e.g. "source-b.example"
	Name       string    `json:"name"`   // display name, e.g. "example source"
	API        string    `json:"api"`    // video source API URL
	Detail     string    `json:"detail"` // site homepage URL
	Enabled    bool      `json:"enabled"`
	IsAdult    bool      `json:"is_adult"`
	Searchable bool      `json:"searchable"` // false if source returned "暂不支持搜索" etc.
	Comment    string    `json:"comment"`
	Health     string    `json:"health"` // healthy, unhealthy, unknown
	LastCheck  time.Time `json:"last_check"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Subscription for auto-updating sources from a config URL.
// Subscription 表示从配置 URL 自动更新视频源的订阅.
type Subscription struct {
	ID         int64     `json:"id"`
	URL        string    `json:"url"`
	AutoUpdate bool      `json:"auto_update"`
	Interval   int       `json:"interval"` // seconds
	LastSync   time.Time `json:"last_sync"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Setting is a key-value pair for site configuration.
// Setting 表示站点配置 key-value.
type Setting struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"` // JSON encoded
	UpdatedAt time.Time `json:"updated_at"`
}

// SearchResult represents a deduplicated search result across multiple sources.
// SearchResult 表示跨多个视频源去重后的搜索结果.
type SearchResult struct {
	Title   string         `json:"title"`
	Type    string         `json:"type"`
	Year    string         `json:"year"`
	Cover   string         `json:"cover"`
	Desc    string         `json:"desc"`
	Sources []SourceResult `json:"sources"`
}

// SourceResult represents one source's data for a specific video.
// SourceResult 表示某个视频源中指定视频的数据.
type SourceResult struct {
	SourceKey  string    `json:"source_key"`
	SourceName string    `json:"source_name"`
	IsAdult    bool      `json:"is_adult"`
	VideoID    string    `json:"video_id"`
	Duration   float64   `json:"duration_ms"` // response time in ms
	Episodes   []Episode `json:"episodes"`
}

// Episode represents a single episode/video URL.
// Episode 表示单个分集或视频 URL.
type Episode struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// VideoDetail represents full detail of a video from a specific source.
// VideoDetail 表示来自指定视频源的视频完整详情.
type VideoDetail struct {
	ID       string      `json:"id"`
	Title    string      `json:"title"`
	Type     string      `json:"type"`
	Year     string      `json:"year"`
	Cover    string      `json:"cover"`
	Desc     string      `json:"desc"`
	Director string      `json:"director"`
	Actor    string      `json:"actor"`
	Area     string      `json:"area"`
	Episodes [][]Episode `json:"episodes"` // multiple CDN lines, each with episodes
}

// VideoSourceResponse is the standard compatible video-source API response.
// VideoSourceResponse 表示标准兼容视频源 API 响应.
// Note: page, pagecount, limit, and total use any because compatible backends
// return them as either string or number inconsistently.
// 注意: page, pagecount, limit 和 total 使用 any, 因为兼容后端可能返回 string 或 number.
type VideoSourceResponse struct {
	Code      int               `json:"code"`
	Msg       string            `json:"msg"`
	Page      any               `json:"page"`
	PageCount any               `json:"pagecount"`
	Limit     any               `json:"limit"`
	Total     any               `json:"total"`
	List      []VideoSourceItem `json:"list"`
}

// VideoSourceItem is a single video item from a compatible video-source API.
// VideoSourceItem 表示兼容视频源 API 返回的单个视频条目.
// Note: VodID uses any because some backends return it as int, others as string.
// 注意: VodID 使用 any, 因为部分后端返回 int, 部分后端返回 string.
type VideoSourceItem struct {
	VodID       any    `json:"vod_id"`
	VodName     string `json:"vod_name"`
	TypeName    string `json:"type_name"`
	VodYear     string `json:"vod_year"`
	VodPic      string `json:"vod_pic"`
	VodBlurb    string `json:"vod_blurb"`
	VodContent  string `json:"vod_content"`
	VodDirector string `json:"vod_director"`
	VodActor    string `json:"vod_actor"`
	VodArea     string `json:"vod_area"`
	VodPlayURL  string `json:"vod_play_url"`
}

// SourceConfig is the top-level structure of an imported source config.
// SourceConfig 表示导入视频源配置的顶层结构.
type SourceConfig struct {
	CacheTTL int                          `json:"cache_time"`
	Sites    map[string]SourceConfigEntry `json:"api_site"`
}

// SourceConfigEntry is a single source entry in the config.
// SourceConfigEntry 表示配置中的单个视频源条目.
type SourceConfigEntry struct {
	Name    string `json:"name"`
	API     string `json:"api"`
	Detail  string `json:"detail"`
	Comment string `json:"_comment,omitempty"`
}
