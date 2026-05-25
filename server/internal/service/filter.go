package service

import (
	"strings"

	"github.com/mritd/kmtv/internal/model"
)

// isAdultSource checks whether a source name indicates adult content.
// isAdultSource 检查视频源名称是否表示成人内容.
func isAdultSource(name string) bool {
	return strings.Contains(name, "\U0001F51E") || strings.Contains(name, "18禁")
}

// FilterAdultSources removes adult content sources from the list.
// FilterAdultSources 从列表中移除成人内容视频源.
func FilterAdultSources(sources []model.Source) []model.Source {
	var filtered []model.Source
	for _, s := range sources {
		if !isAdultSource(s.Name) {
			filtered = append(filtered, s)
		}
	}
	return filtered
}

// FilterAdultResults removes adult source results.
// If a SearchResult has no sources left after filtering, remove it entirely.
// FilterAdultResults 移除成人内容视频源结果.
// 如果 SearchResult 过滤后没有剩余视频源, 则整体移除.
func FilterAdultResults(results []model.SearchResult) []model.SearchResult {
	var filtered []model.SearchResult
	for _, r := range results {
		var sources []model.SourceResult
		for _, sr := range r.Sources {
			if !isAdultSource(sr.SourceName) {
				sources = append(sources, sr)
			}
		}
		if len(sources) > 0 {
			r.Sources = sources
			filtered = append(filtered, r)
		}
	}
	return filtered
}
