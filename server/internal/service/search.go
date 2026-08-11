package service

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/config"
	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/model"
	appruntime "github.com/mritd/kmtv/internal/runtime"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/utils"
	"github.com/mritd/kmtv/internal/vodsource"
)

// SearchService provides multi-source aggregated search.
//
// SearchService 提供多视频源聚合搜索能力.
type SearchService struct {
	store        *store.Store
	sourceClient *vodsource.Client
	proxySvc     *ProxyService
}

// NewSearchService creates a new SearchService.
//
// NewSearchService 创建一个新的 SearchService.
func NewSearchService(s *store.Store, ps *ProxyService) *SearchService {
	return NewSearchServiceWithClient(s, ps, NewSSRFSafeClient(30*time.Second))
}

// NewSearchServiceWithClient creates a SearchService with an injected HTTP client.
//
// NewSearchServiceWithClient 使用注入的 HTTP client 创建 SearchService.
func NewSearchServiceWithClient(s *store.Store, ps *ProxyService, client *http.Client) *SearchService {
	if client == nil {
		client = NewSSRFSafeClient(30 * time.Second)
	}
	return &SearchService{
		store:        s,
		sourceClient: vodsource.NewClient(client),
		proxySvc:     ps,
	}
}

// rawSearchResult holds a single source's search result before deduplication.
//
// rawSearchResult 保存去重前的单个视频源搜索结果.
type rawSearchResult struct {
	SourceKey  string
	SourceName string
	IsAdult    bool
	Duration   float64 // response time in ms
	Item       model.VideoSourceItem
	Episodes   []model.Episode // pre-validated episodes from working CDN line
}

type searchResultEntry struct {
	result        model.SearchResult
	fastest       float64
	originalIndex int
	rank          searchRankKey
}

// ProgressFunc is called to report search progress.
// phase is "searching" or "probing"; completed and total are counts.
// It may be called concurrently from multiple goroutines.
//
// ProgressFunc 用于报告搜索进度.
// phase 为 "searching" 或 "probing"; completed 和 total 表示计数.
// 它可能被多个 goroutine 并发调用.
type ProgressFunc func(phase string, completed, total int)

// Search performs multi-source aggregated search (blocking, no progress).
//
// Search 执行多视频源聚合搜索, 阻塞等待结果且不报告进度.
func (ss *SearchService) Search(ctx context.Context, query string, page int, adultFilter bool) ([]model.SearchResult, error) {
	return ss.SearchWithProgress(ctx, query, page, adultFilter, nil)
}

// SearchWithProgress performs multi-source aggregated search with optional progress callbacks.
// If onProgress is nil, no progress events are emitted.
//
// SearchWithProgress 执行多视频源聚合搜索, 并可选报告进度.
// 如果 onProgress 为 nil, 则不发出进度事件.
func (ss *SearchService) SearchWithProgress(ctx context.Context, query string, page int, adultFilter bool, onProgress ProgressFunc) ([]model.SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}

	sources, err := ss.store.ListEnabledHealthySources()
	if err != nil {
		return nil, fmt.Errorf("list sources: %w", err)
	}

	if adultFilter {
		sources = FilterAdultSources(sources)
	}

	if len(sources) == 0 {
		return nil, nil
	}

	// Phase 1: Concurrent search across all sources without CDN probing.
	//
	// 第一阶段: 并发搜索所有视频源, 暂不做 CDN 探测.
	type searchHit struct {
		SourceKey  string
		SourceName string
		IsAdult    bool
		Duration   float64
		Item       model.VideoSourceItem
	}

	searchTotal := len(sources)
	var searchDone atomic.Int32

	// Fan out source searches through the shared helper and flatten successful hits.
	//
	// 通过共享 helper 并发搜索视频源, 再合并成功返回的命中结果.
	searchResults, err := utils.GoProcess(ctx, sources, GetSearchConcurrency(), false, func(ctx context.Context, src model.Source) ([]searchHit, error) {
		defer func() {
			done := int(searchDone.Add(1))
			if onProgress != nil {
				onProgress("searching", done, searchTotal)
			}
		}()

		searchURL := buildVideoSourceSearchURL(src.API, query, page)
		start := time.Now()

		reqCtx, cancel := context.WithTimeout(ctx, GetSearchTimeout())
		defer cancel()
		sourceResp, body, err := ss.sourceClient.FetchList(reqCtx, searchURL)
		duration := float64(time.Since(start).Milliseconds())
		if err != nil {
			bodyStr := strings.TrimSpace(string(body))
			if isSearchDisabled(bodyStr) {
				logrus.WithFields(logrus.Fields{
					"source": src.Key,
					"body":   utils.Truncate(bodyStr, 100),
				}).Warn("source does not support search, disabling")
				if err := ss.store.UpdateSourceSearchable(src.ID, false); err != nil {
					logrus.WithError(err).WithField("source", src.Key).Error("failed to mark source as non-searchable")
				}
				return nil, nil
			}
			logSearchFetchError(src.Key, searchURL, bodyStr, err)
			return nil, nil
		}

		hits := make([]searchHit, 0, len(sourceResp.List))
		for _, item := range sourceResp.List {
			if item.VodPlayURL == "" {
				continue
			}
			hits = append(hits, searchHit{
				SourceKey:  src.Key,
				SourceName: src.Name,
				IsAdult:    src.IsAdult,
				Duration:   duration,
				Item:       item,
			})
		}
		return hits, nil
	})
	if err != nil {
		return nil, err
	}

	var hits []searchHit
	for _, items := range searchResults {
		hits = append(hits, items...)
	}

	// Phase 2: CDN probe for each hit.
	//
	// 第二阶段: 对每个命中结果执行 CDN 探测.
	probeTotal := len(hits)
	var probeDone atomic.Int32

	// Probe search hits through the shared helper; nil results preserve old skip behavior.
	//
	// 通过共享 helper 探测搜索命中; nil 结果保持旧逻辑中的跳过行为.
	probed, err := utils.GoProcess(ctx, hits, searchProbeConcurrencyLimit(), false, func(ctx context.Context, h searchHit) (*rawSearchResult, error) {
		defer func() {
			done := int(probeDone.Add(1))
			if onProgress != nil {
				onProgress("probing", done, probeTotal)
			}
		}()

		allGroups := config.ParseAllEpisodeGroups(h.Item.VodPlayURL)
		if appruntime.Default().PlaybackMode() == consts.PlaybackModeDirect {
			// Search results can expose only one episode list, so direct mode keeps the first parsed line.
			//
			// 搜索结果当前只能表达一条分集列表, 因此 direct 模式保留解析出的第一条线路.
			if len(allGroups) == 0 {
				return nil, nil
			}
			return &rawSearchResult{
				SourceKey:  h.SourceKey,
				SourceName: h.SourceName,
				IsAdult:    h.IsAdult,
				Duration:   h.Duration,
				Item:       h.Item,
				Episodes:   allGroups[0],
			}, nil
		}

		alive := ss.proxySvc.ProbeLines(ctx, allGroups)
		if len(alive) == 0 {
			logrus.WithFields(logrus.Fields{
				"source": h.SourceKey,
				"video":  h.Item.VodName,
			}).Warn("all CDN lines dead, skipping source for this video")
			return nil, nil
		}
		return &rawSearchResult{
			SourceKey:  h.SourceKey,
			SourceName: h.SourceName,
			IsAdult:    h.IsAdult,
			Duration:   h.Duration,
			Item:       h.Item,
			Episodes:   alive[0],
		}, nil
	})
	if err != nil {
		return nil, err
	}

	probeResults := make([]rawSearchResult, 0, len(probed))
	for _, result := range probed {
		if result != nil {
			probeResults = append(probeResults, *result)
		}
	}

	entries := mergeSearchResults(probeResults)
	if adultFilter {
		entries = filterAdultSearchEntries(entries)
	}
	rankSearchEntries(query, entries)
	return searchEntriesToResults(entries), nil
}

// searchProbeConcurrencyLimit returns the concurrency limit for search-time CDN probes.
//
// searchProbeConcurrencyLimit 返回搜索阶段 CDN 探测使用的并发限制.
func searchProbeConcurrencyLimit() int {
	return GetProbeConcurrency()
}

func logSearchFetchError(sourceKey, searchURL, body string, err error) {
	fields := logrus.Fields{
		"source": sourceKey,
		"url":    searchURL,
	}
	if body != "" {
		fields["body"] = utils.Truncate(body, 200)
	}
	logrus.WithError(err).WithFields(fields).Warn("fetch search response failed")
}

// buildVideoSourceSearchURL builds a compatible video-source search URL.
//
// buildVideoSourceSearchURL 构造兼容视频源搜索 URL.
func buildVideoSourceSearchURL(apiURL, query string, page int) string {
	return vodsource.BuildSearchURL(apiURL, query, page)
}

func mergeSearchResults(results []rawSearchResult) []searchResultEntry {
	type dedupKey struct {
		title string
		year  string
	}
	entryMap := make(map[dedupKey]*searchResultEntry)
	entrySources := make(map[dedupKey]map[string]struct{})
	var order []dedupKey

	for _, r := range results {
		k := dedupKey{
			title: strings.TrimSpace(r.Item.VodName),
			year:  strings.TrimSpace(r.Item.VodYear),
		}
		if k.title == "" {
			k.title = r.Item.VodName
		}

		sr := model.SourceResult{
			SourceKey:  r.SourceKey,
			SourceName: r.SourceName,
			IsAdult:    r.IsAdult,
			VideoID:    model.FormatID(r.Item.VodID),
			Duration:   r.Duration,
			Episodes:   r.Episodes,
		}

		entry, exists := entryMap[k]
		if !exists {
			entry = &searchResultEntry{
				result: model.SearchResult{
					Title: r.Item.VodName,
					Type:  r.Item.TypeName,
					Year:  r.Item.VodYear,
					Cover: r.Item.VodPic,
					Desc:  searchBestDesc(r.Item.VodBlurb, r.Item.VodContent),
				},
				fastest:       searchDurationSortValue(r.Duration),
				originalIndex: len(order),
			}
			entryMap[k] = entry
			entrySources[k] = make(map[string]struct{})
			order = append(order, k)
		}

		if _, seen := entrySources[k][r.SourceKey]; !seen {
			entrySources[k][r.SourceKey] = struct{}{}
			entry.result.Sources = append(entry.result.Sources, sr)
			if duration := searchDurationSortValue(r.Duration); duration < entry.fastest {
				entry.fastest = duration
			}
		}
		// Prefer non-empty desc from any source: try VodBlurb first, then cleaned VodContent.
		//
		// 优先使用任意视频源的非空简介: 先尝试 VodBlurb, 再尝试清洗后的 VodContent.
		if entry.result.Desc == "" {
			if blurb := strings.TrimSpace(r.Item.VodBlurb); blurb != "" {
				entry.result.Desc = blurb
			} else if content := utils.StripHTML(r.Item.VodContent); content != "" {
				entry.result.Desc = content
			}
		}
	}

	entries := make([]searchResultEntry, 0, len(order))
	for _, k := range order {
		entries = append(entries, *entryMap[k])
	}
	return entries
}

func searchDurationSortValue(duration float64) float64 {
	if duration < 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return math.Inf(1)
	}
	return duration
}

func filterAdultSearchEntries(entries []searchResultEntry) []searchResultEntry {
	filtered := make([]searchResultEntry, 0, len(entries))
	for _, entry := range entries {
		sources := make([]model.SourceResult, 0, len(entry.result.Sources))
		fastest := math.Inf(1)
		for _, source := range entry.result.Sources {
			if source.IsAdult {
				continue
			}
			sources = append(sources, source)
			if duration := searchDurationSortValue(source.Duration); duration < fastest {
				fastest = duration
			}
		}
		if len(sources) == 0 {
			continue
		}
		entry.result.Sources = sources
		entry.fastest = fastest
		filtered = append(filtered, entry)
	}
	return filtered
}

func rankSearchEntries(query string, entries []searchResultEntry) {
	normalizedQuery := searchComparisonKey(query)
	for i := range entries {
		entries[i].rank = buildSearchRankKeyFromNormalizedQuery(normalizedQuery, entries[i].result.Title, entries[i].result.Year)
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].rank.tier != entries[j].rank.tier {
			return entries[i].rank.tier < entries[j].rank.tier
		}
		if entries[i].rank.similarity != entries[j].rank.similarity {
			return entries[i].rank.similarity > entries[j].rank.similarity
		}
		if len(entries[i].result.Sources) != len(entries[j].result.Sources) {
			return len(entries[i].result.Sources) > len(entries[j].result.Sources)
		}
		if entries[i].fastest != entries[j].fastest {
			return entries[i].fastest < entries[j].fastest
		}
		return entries[i].originalIndex < entries[j].originalIndex
	})
}

func searchEntriesToResults(entries []searchResultEntry) []model.SearchResult {
	merged := make([]model.SearchResult, len(entries))
	for i, e := range entries {
		merged[i] = e.result
	}
	return merged
}

// searchBestDesc returns the best description: prefer VodBlurb, fallback to cleaned VodContent.
//
// searchBestDesc 返回最佳简介: 优先 VodBlurb, 回退到清洗后的 VodContent.
func searchBestDesc(blurb, content string) string {
	return vodsource.BestDescription(blurb, content)
}

// searchDisabledKeywords are responses that indicate a source has search permanently disabled.
//
// searchDisabledKeywords 是表示视频源永久禁用搜索的响应关键字.
var searchDisabledKeywords = []string{
	"暂不支持搜索",
	"搜索关闭",
	"搜索功能关闭",
	"禁止搜索",
	"不支持搜索",
	"搜索已关闭",
}

// isSearchDisabled checks if a response body contains keywords indicating search is disabled.
//
// isSearchDisabled 检查响应体是否包含表示搜索已禁用的关键字.
func isSearchDisabled(body string) bool {
	for _, kw := range searchDisabledKeywords {
		if strings.Contains(body, kw) {
			return true
		}
	}
	return false
}
