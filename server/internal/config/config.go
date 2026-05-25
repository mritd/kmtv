package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/mritd/kmtv/internal/base58"
	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/model"
)

// ParsedConfig is the result of parsing an imported source config.
// ParsedConfig 表示解析导入视频源配置后的结果.
type ParsedConfig struct {
	CacheTTL int
	Sources  []model.Source
}

// ParseSourceConfig parses imported source config data from an io.Reader.
// It auto-detects whether the input is base58-encoded or plain JSON.
// Returns sources sorted by key for deterministic order.
// ParseSourceConfig 从 io.Reader 解析导入视频源配置.
// 它会自动检测输入是 base58 编码还是普通 JSON.
// 返回的视频源按 key 排序, 保证顺序稳定.
func ParseSourceConfig(r io.Reader) (*ParsedConfig, error) {
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	raw = bytes.TrimSpace(raw)

	// Auto-detect format: if it starts with '{', treat as JSON; otherwise try base58.
	// 自动检测格式: 以 "{" 开头则按 JSON 处理, 否则尝试 base58.
	data := raw
	if len(raw) > 0 && raw[0] != '{' {
		decoded := base58.Decode(string(raw))
		if len(decoded) == 0 {
			return nil, fmt.Errorf("base58 decode failed: invalid input")
		}
		data = decoded
	}

	var cfg model.SourceConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("decode source config: %w", err)
	}

	// Collect and sort keys for deterministic order.
	// 收集并排序 key, 保证输出顺序稳定.
	keys := make([]string, 0, len(cfg.Sites))
	for k := range cfg.Sites {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	sources := make([]model.Source, 0, len(keys))
	for _, k := range keys {
		s := cfg.Sites[k]
		sources = append(sources, model.Source{
			Key:     k,
			Name:    s.Name,
			API:     s.API,
			Detail:  s.Detail,
			Comment: s.Comment,
			Enabled: true,
			Health:  consts.HealthUnknown,
		})
	}

	return &ParsedConfig{
		CacheTTL: cfg.CacheTTL,
		Sources:  sources,
	}, nil
}

// ParseEpisodes parses the video-source vod_play_url compatible format.
// ParseEpisodes 解析视频源 vod_play_url 兼容格式.
// Format: title$url#title$url$$$title$url#title$url.
// 格式: title$url#title$url$$$title$url#title$url.
// $$$ separates source groups, # separates episodes, $ separates name and URL.
// $$$ 分隔线路组, # 分隔分集, $ 分隔名称和 URL.
// Returns episodes from the first source group.
// 返回第一个线路组里的分集.
func ParseEpisodes(raw string) []model.Episode {
	groups := ParseAllEpisodeGroups(raw)
	if len(groups) == 0 {
		return nil
	}
	return groups[0]
}

// ParseAllEpisodeGroups returns all source groups.
// ParseAllEpisodeGroups 返回所有线路组.
func ParseAllEpisodeGroups(raw string) [][]model.Episode {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	groupParts := strings.Split(raw, "$$$")
	groups := make([][]model.Episode, 0, len(groupParts))

	for _, gp := range groupParts {
		gp = strings.TrimSpace(gp)
		if gp == "" {
			continue
		}
		entries := strings.Split(gp, "#")
		var episodes []model.Episode
		for _, entry := range entries {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			idx := strings.Index(entry, "$")
			if idx < 0 {
				continue
			}
			u := entry[idx+1:]
			// Only accept .m3u8 URLs. Sources often store ordinary HTML watch-page links
			// which are not playable via proxy.
			// 只接受 .m3u8 URL. 视频源经常保存普通 HTML 播放页链接, 这些链接无法通过代理播放.
			if !strings.HasSuffix(strings.SplitN(u, "?", 2)[0], ".m3u8") {
				continue
			}
			episodes = append(episodes, model.Episode{
				Name: entry[:idx],
				URL:  u,
			})
		}
		if len(episodes) > 0 {
			groups = append(groups, episodes)
		}
	}

	return groups
}
