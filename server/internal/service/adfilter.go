package service

import (
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/mritd/kmtv/internal/utils"
)

const (
	// maxAdRunSeconds caps one removable run; a longer foreign run is treated as content.
	//
	// maxAdRunSeconds 是单段可移除内容的时长上限; 更长的外部目录段视为正片.
	maxAdRunSeconds = 120.0

	// maxAdShare caps the share of the playlist duration the filter may remove.
	//
	// maxAdShare 是过滤器可移除时长占 playlist 总时长比例的上限.
	maxAdShare = 0.25
)

// AdFilterStats reports what FilterInsertedAds removed.
//
// AdFilterStats 记录 FilterInsertedAds 移除的内容.
type AdFilterStats struct {
	Segments int
	Seconds  float64
}

type adFilterSegment struct {
	dir      string
	duration float64
	run      int
}

// FilterInsertedAds removes ad runs that a source splices into a VOD media playlist. Content is
// the segment directory (URL path without host, query, or file name) holding most of the
// duration. An ad directory is a foreign directory found only in short runs (at most
// maxAdRunSeconds) that never touch the content directory, in at least two of them: sources that
// insert ads repeat the same break, while content spliced from another path (a tail, an opening)
// shows up once. A run is removed when all its segments come from ad directories. Within a
// removed run only the key and map tags stay, in order, so every kept segment decrypts as before,
// and one discontinuity stays where content resumes. The playlist comes back unchanged when it is
// a master or live playlist, when a key derives its IV from the media sequence (removing segments
// would renumber the rest), or when the runs to remove exceed maxAdShare of the duration.
//
// FilterInsertedAds 移除源站拼接进 VOD media playlist 的广告段. 正片是承载最多时长的分片目录
// (去掉主机, 查询参数与文件名的 URL 路径). 广告目录是只出现在短段 (不超过 maxAdRunSeconds) 中, 从不与
// 正片目录同段, 且至少出现在两段中的外部目录: 插入广告的源站会重复同一段广告, 而从其他路径拼接的
// 正片 (片尾, 片头) 只出现一次. 某段的全部分片都来自广告目录时, 移除该段. 被移除的段只保留 key 与 map
// 标签并维持原顺序, 因此保留的分片解密方式不变, 正片恢复处保留一个 discontinuity. 以下情况原样返回:
// master 或直播 playlist, 某个 key 由 media sequence 推导 IV (删除分片会让其余分片重新编号), 或待
// 删除段超过总时长的 maxAdShare.
func FilterInsertedAds(content, baseURL string) (string, AdFilterStats) {
	lines := strings.Split(content, "\n")
	var segments []adFilterSegment
	var discontinuities []int
	firstLine := -1
	duration := 0.0
	endList, implicitIV := false, false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "#EXT-X-STREAM-INF"):
			return content, AdFilterStats{}
		case trimmed == "#EXT-X-ENDLIST":
			endList = true
		case trimmed == "#EXT-X-DISCONTINUITY":
			discontinuities = append(discontinuities, i)
		case strings.HasPrefix(trimmed, "#EXT-X-KEY:"):
			attrs := hlsAttributes(strings.TrimPrefix(trimmed, "#EXT-X-KEY:"))
			if _, hasIV := attrs["IV"]; attrs["METHOD"] != "NONE" && !hasIV {
				implicitIV = true
			}
		case strings.HasPrefix(trimmed, "#EXTINF:"):
			if firstLine < 0 {
				firstLine = i
			}
			value, _, _ := strings.Cut(strings.TrimPrefix(trimmed, "#EXTINF:"), ",")
			duration, _ = strconv.ParseFloat(strings.TrimSpace(value), 64)
		case trimmed == "" || strings.HasPrefix(trimmed, "#"):
		default:
			if firstLine < 0 {
				firstLine = i
			}
			segments = append(segments, adFilterSegment{
				dir:      segmentDir(utils.ResolveURL(baseURL, trimmed)),
				duration: duration,
				run:      len(discontinuities),
			})
			duration = 0
		}
	}
	if !endList || implicitIV || len(discontinuities) == 0 || len(segments) == 0 {
		return content, AdFilterStats{}
	}

	byDir := map[string]float64{}
	total := 0.0
	for _, s := range segments {
		byDir[s.dir] += s.duration
		total += s.duration
	}
	main, best := "", -1.0
	for dir, seconds := range byDir {
		if seconds > best || (seconds == best && dir < main) {
			main, best = dir, seconds
		}
	}

	runSeconds := map[int]float64{}
	touchesMain := map[int]bool{}
	for _, s := range segments {
		runSeconds[s.run] += s.duration
		if s.dir == main {
			touchesMain[s.run] = true
		}
	}
	shortForeign := func(run int) bool { return !touchesMain[run] && runSeconds[run] <= maxAdRunSeconds }
	dirRuns := map[string]map[int]bool{}
	disqualified := map[string]bool{}
	for _, s := range segments {
		if s.dir == main {
			continue
		}
		if !shortForeign(s.run) {
			disqualified[s.dir] = true
		}
		if dirRuns[s.dir] == nil {
			dirRuns[s.dir] = map[int]bool{}
		}
		dirRuns[s.dir][s.run] = true
	}
	isAdDir := func(dir string) bool { return !disqualified[dir] && len(dirRuns[dir]) >= 2 }
	ads := map[int]bool{}
	for _, s := range segments {
		if s.dir != main {
			ads[s.run] = true
		}
	}
	for _, s := range segments {
		if s.dir == main || !isAdDir(s.dir) {
			delete(ads, s.run)
		}
	}
	stats := AdFilterStats{}
	for _, s := range segments {
		if ads[s.run] {
			stats.Segments++
			stats.Seconds += s.duration
		}
	}
	if stats.Segments == 0 || total <= 0 || stats.Seconds > total*maxAdShare {
		return content, AdFilterStats{}
	}

	// Run r spans from the line after discontinuity r-1 (or the first segment line, for run 0) to
	// the line before discontinuity r (or the end). A removed run drops every line in its span but
	// key, map, and end tags, plus its leading discontinuity, so content resumes after exactly one;
	// a removed pre-roll drops the trailing discontinuity instead.
	//
	// 第 r 段从第 r-1 个 discontinuity 的下一行 (第 0 段从第一个分片行) 开始, 到第 r 个 discontinuity
	// 的上一行 (或末尾) 结束. 被移除的段删除范围内除 key, map 与结束标签之外的所有行, 并带走它前面的
	// discontinuity, 正片因此只在一个 discontinuity 之后恢复; 被移除的片头广告则带走它后面的那个.
	drop := map[int]bool{}
	for run := range ads {
		from, to := firstLine, len(lines)-1
		if run > 0 {
			from = discontinuities[run-1] + 1
			drop[discontinuities[run-1]] = true
		} else {
			drop[discontinuities[0]] = true
		}
		if run < len(discontinuities) {
			to = discontinuities[run] - 1
		}
		for i := from; i <= to; i++ {
			trimmed := strings.TrimSpace(lines[i])
			if !strings.HasPrefix(trimmed, "#EXT-X-KEY:") && !strings.HasPrefix(trimmed, "#EXT-X-MAP:") &&
				trimmed != "#EXT-X-ENDLIST" {
				drop[i] = true
			}
		}
	}
	kept := make([]string, 0, len(lines)-len(drop))
	for i, line := range lines {
		if !drop[i] {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n"), stats
}

// hlsAttributes parses an HLS attribute list (KEY=VALUE pairs separated by commas, where quoted
// values may contain commas) into a map with the quotes removed.
//
// hlsAttributes 将 HLS 属性列表 (以逗号分隔的 KEY=VALUE, 带引号的值中可以含逗号) 解析为去掉引号的 map.
func hlsAttributes(list string) map[string]string {
	attrs := map[string]string{}
	for list != "" {
		name, rest, ok := strings.Cut(list, "=")
		if !ok {
			break
		}
		var value string
		if strings.HasPrefix(rest, `"`) {
			quoted, after, _ := strings.Cut(rest[1:], `"`)
			value, rest = quoted, after
			_, rest, _ = strings.Cut(rest, ",")
		} else {
			value, rest, _ = strings.Cut(rest, ",")
		}
		attrs[strings.TrimSpace(name)] = strings.TrimSpace(value)
		list = rest
	}
	return attrs
}

// segmentDir returns the directory of a segment URL path, ignoring host, query, and fragment, so
// content spread over several CDN hosts or signed per segment still shares one directory.
//
// segmentDir 返回分片 URL 路径所在目录, 忽略主机, 查询参数与片段, 因此分布在多个 CDN 主机或逐个
// 签名的正片仍属于同一目录.
func segmentDir(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	return path.Dir(u.Path)
}
