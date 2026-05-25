package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/vodsource"
)

func mediaToken(t *testing.T, h *Handler, kind, rawURL, sourceKey string) string {
	t.Helper()
	token, err := h.mediaSvc.IssueMediaToken(0, kind, rawURL, sourceKey, time.Minute)
	if err != nil {
		t.Fatalf("IssueMediaToken %s %q: %v", kind, rawURL, err)
	}
	return token
}

func TestSearch_MissingQuery(t *testing.T) {
	_, r := setupTestHandler(t)
	// anonymous_access defaults to "true", so no bearer token is needed.

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSearch_WithQuery(t *testing.T) {
	_, r := setupTestHandler(t)
	// No sources configured, so results will be empty but should not error.

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=test", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSearchEnrichesMissingDescription(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("ac") {
		case "videolist":
			if r.URL.Query().Get("ids") != "" {
				_, _ = w.Write([]byte(`{
					"code": 1,
					"list": [{
						"vod_id": 201,
						"vod_name": "Search Movie",
						"vod_blurb": "",
						"vod_content": "<p>Detailed description</p>",
						"vod_play_url": "HD$` + upstream.URL + `/live/search.m3u8"
					}]
				}`))
				return
			}
			_, _ = w.Write([]byte(`{
				"code": 1,
				"list": [{
					"vod_id": 201,
					"vod_name": "Search Movie",
					"type_name": "movie",
					"vod_year": "2026",
					"vod_blurb": "",
					"vod_content": "",
					"vod_play_url": "HD$` + upstream.URL + `/live/search.m3u8"
				}]
			}`))
		default:
			if r.URL.Path == "/live/search.m3u8" {
				w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
				_, _ = w.Write([]byte("#EXTM3U\n#EXTINF:10,\nseg.ts\n"))
				return
			}
			t.Fatalf("unexpected upstream request: %s", r.URL.String())
		}
	}))
	defer upstream.Close()

	h, r := setupTestHandler(t)
	h.sourceClient = vodsource.NewClient(upstream.Client())
	h.proxySvc = service.NewProxyServiceWithClient(upstream.Client())
	h.searchSvc = service.NewSearchServiceWithClient(h.store, h.proxySvc, upstream.Client())
	id, err := h.store.CreateSource(&model.Source{
		Key:        "search-enrich.example",
		Name:       "Search Enrich",
		API:        upstream.URL + "/api.php/provide/vod",
		Enabled:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	if err := h.store.UpdateSourceHealth(id, consts.HealthHealthy); err != nil {
		t.Fatalf("UpdateSourceHealth error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=search+movie", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	results := m["results"].([]any)
	if len(results) != 1 {
		t.Fatalf("expected one result, got %+v", m)
	}
	result := results[0].(map[string]any)
	if result["desc"] != "Detailed description" {
		t.Fatalf("desc = %q, want Detailed description", result["desc"])
	}
}

func TestSearchFiltersAdultSourcesByUserAccess(t *testing.T) {
	var searchRequests int
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		searchRequests++
		if r.URL.Query().Get("ac") != "videolist" {
			t.Fatalf("unexpected upstream request: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{
			"code": 1,
			"list": [{
				"vod_id": 101,
				"vod_name": "Adult Movie",
				"type_name": "movie",
				"vod_year": "2026",
				"vod_play_url": "HD$` + upstream.URL + `/live/adult.m3u8"
			}]
		}`))
	}))
	defer upstream.Close()

	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	h.proxySvc = service.NewProxyServiceWithClient(upstream.Client())
	h.searchSvc = service.NewSearchServiceWithClient(h.store, h.proxySvc, upstream.Client())
	id, err := h.store.CreateSource(&model.Source{
		Key:        "adult-search.example",
		Name:       "Adult Search",
		API:        upstream.URL + "/api.php/provide/vod",
		Enabled:    true,
		IsAdult:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	if err := h.store.UpdateSourceHealth(id, consts.HealthHealthy); err != nil {
		t.Fatalf("UpdateSourceHealth error: %v", err)
	}
	createTestUser(t, h, "adult_blocked_search", "pw", "user")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=adult", nil)
	req.Header.Set("Authorization", loginAndGetBearer(t, r, "adult_blocked_search", "pw"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if searchRequests != 0 {
		t.Fatalf("adult source should be filtered before upstream search, got %d requests", searchRequests)
	}
	m := decodeJSON(t, rec)
	if results, ok := m["results"].([]any); ok && len(results) != 0 {
		t.Fatalf("expected no results for blocked user, got %+v", results)
	}
}

func TestSearchSuggestions(t *testing.T) {
	_, r := setupTestHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/search/suggestions?q=abc", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	if _, ok := m["suggestions"].([]any); !ok {
		t.Fatalf("expected suggestions array, got %+v", m)
	}
}

func TestSearchReportsSearchServiceFailureAfterSettingReadFailure(t *testing.T) {
	h, _ := setupTestHandler(t)
	if err := h.store.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/search?q=matrix&page=bad", nil)
	h.Search(c)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestEnrichDescriptionsFetchesDetailFromFastestSource(t *testing.T) {
	h, _ := setupTestHandler(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("ids") != "42" {
			t.Fatalf("unexpected detail query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"code": 1,
			"list": [{
				"vod_id": 42,
				"vod_name": "Detail Movie",
				"vod_blurb": "",
				"vod_content": "<p>Detailed description</p>"
			}]
		}`))
	}))
	defer upstream.Close()
	h.sourceClient = vodsource.NewClient(upstream.Client())

	if _, err := h.store.CreateSource(&model.Source{
		Key:        "detail-source.example",
		Name:       "Detail Source",
		API:        upstream.URL + "/api.php/provide/vod",
		Enabled:    true,
		Searchable: true,
	}); err != nil {
		t.Fatalf("CreateSource: %v", err)
	}

	results := []model.SearchResult{{
		Title: "Detail Movie",
		Sources: []model.SourceResult{{
			SourceKey: "detail-source.example",
			VideoID:   "42",
		}},
	}}
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/search?q=detail", nil)

	h.enrichDescriptions(c, results)
	if results[0].Desc != "Detailed description" {
		t.Fatalf("desc = %q, want detail description", results[0].Desc)
	}
}

// ---------- Douban handler tests ----------

func TestDoubanCategories(t *testing.T) {
	_, r := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/douban/categories", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	categories, ok := m["categories"]
	if !ok {
		t.Fatal("expected 'categories' key in response")
	}
	arr, ok := categories.([]any)
	if !ok {
		t.Fatal("expected categories to be an array")
	}
	if len(arr) == 0 {
		t.Error("expected at least one category")
	}
}

func TestDoubanList_MissingType(t *testing.T) {
	_, r := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/douban/list?category=热门", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	errMsg, ok := m["error"].(string)
	if !ok || errMsg != "type must be 'movie' or 'tv'" {
		t.Errorf("expected error about type, got %v", m["error"])
	}
}

func TestDoubanHandlersSuccess(t *testing.T) {
	h, r := setupTestHandler(t)
	h.doubanSvc = service.NewDoubanServiceWithClient(h.store, &http.Client{Transport: serviceRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/j/search_subjects":
			return testStringResponse(http.StatusOK, `{"subjects":[{"id":"1","title":"List Movie","cover":"https://img1.doubanio.com/a.jpg","rate":"8.1"}]}`), nil
		case "/rexxar/api/v2/subject/recent_hot/movie":
			return testStringResponse(http.StatusOK, `{"items":[{"id":"2","title":"Hot Movie","card_subtitle":"2026 / 中国大陆","pic":{"normal":"https://img1.doubanio.com/b.jpg"},"rating":{"value":8.2}}]}`), nil
		case "/rexxar/api/v2/movie/recommend":
			return testStringResponse(http.StatusOK, `{"items":[{"id":"3","title":"Filter Movie","type":"movie","year":"2025","pic":{"normal":"https://img1.doubanio.com/c.jpg"},"rating":{"value":8.3}}]}`), nil
		default:
			t.Fatalf("unexpected douban path: %s", req.URL.Path)
			return nil, nil
		}
	})})

	tests := []string{
		"/api/v1/douban/list?category=%E7%83%AD%E9%97%A8&type=movie&count=2",
		"/api/v1/douban/recommend",
		"/api/v1/douban/recommend/filter?kind=movie&format=%E7%94%B5%E5%BD%B1&region=%E4%B8%AD%E5%9B%BD%E5%A4%A7%E9%99%86",
		"/api/v1/douban/recommend/filter?kind=movie&tag=%E7%83%AD%E9%97%A8&format=%E7%94%B5%E5%BD%B1&region=%E4%B8%AD%E5%9B%BD%E5%A4%A7%E9%99%86",
	}
	for _, path := range tests {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
			}
			m := decodeJSON(t, rec)
			items, ok := m["items"].([]any)
			if !ok || len(items) == 0 {
				t.Fatalf("expected non-empty items, got %+v", m)
			}
		})
	}
}

func TestRecentHotRegionType(t *testing.T) {
	tests := []struct {
		format string
		region string
		want   string
	}{
		{format: "电视剧", region: "华语", want: "tv_domestic"},
		{format: "电视剧", region: "欧美", want: "tv_american"},
		{format: "电视剧", region: "日本", want: "tv_japanese"},
		{format: "电视剧", region: "韩国", want: "tv_korean"},
		{format: "电视剧", region: "", want: "tv"},
		{format: "综艺", region: "华语", want: "show_domestic"},
		{format: "综艺", region: "欧美", want: "show_foreign"},
		{format: "电影", region: "中国大陆", want: "中国大陆"},
		{format: "电影", region: "", want: "全部"},
	}
	for _, tt := range tests {
		t.Run(tt.format+"/"+tt.region, func(t *testing.T) {
			if got := recentHotRegionType(tt.format, tt.region); got != tt.want {
				t.Fatalf("recentHotRegionType() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDoubanHomeSections(t *testing.T) {
	h, r := setupTestHandler(t)
	h.doubanSvc = service.NewDoubanServiceWithClient(h.store, &http.Client{Transport: serviceRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch req.URL.Path {
		case "/rexxar/api/v2/subject/recent_hot/movie":
			return testStringResponse(http.StatusOK, recentHotHandlerBody("movie-home", "Movie Home", "8.8")), nil
		case "/rexxar/api/v2/subject/recent_hot/tv":
			return testStringResponse(http.StatusOK, recentHotHandlerBody("tv-home", "TV Home", "8.1")), nil
		case "/rexxar/api/v2/tv/recommend":
			return testStringResponse(http.StatusOK, recommendHandlerBody("anime-tv", "Anime TV", "tv", "8.7")), nil
		case "/rexxar/api/v2/movie/recommend":
			return testStringResponse(http.StatusOK, recommendHandlerBody("anime-movie", "Anime Movie", "movie", "9.0")), nil
		default:
			if strings.HasPrefix(req.URL.Path, "/rexxar/api/v2/movie/") || strings.HasPrefix(req.URL.Path, "/rexxar/api/v2/tv/") {
				return testStringResponse(http.StatusOK, `{"intro":"Home hero description"}`), nil
			}
			t.Fatalf("unexpected douban path: %s", req.URL.Path)
			return nil, nil
		}
	})})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/douban/home", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	sections, ok := m["sections"].([]any)
	if !ok || len(sections) != 4 {
		t.Fatalf("expected four sections, got %+v", m)
	}
}

func TestDoubanHandlersReportUpstreamFailures(t *testing.T) {
	h, r := setupTestHandler(t)
	h.doubanSvc = service.NewDoubanServiceWithClient(h.store, &http.Client{Transport: serviceRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		return testStringResponse(http.StatusForbidden, "blocked"), nil
	})})

	tests := []string{
		"/api/v1/douban/list?category=%E7%83%AD%E9%97%A8&type=movie&start=bad&count=100",
		"/api/v1/douban/recommend",
		"/api/v1/douban/recommend/filter?kind=movie&tag=%E7%83%AD%E9%97%A8&format=%E7%94%B5%E5%BD%B1&region=%E4%B8%AD%E5%9B%BD%E5%A4%A7%E9%99%86&start=bad&count=100",
		"/api/v1/douban/recommend/filter?kind=movie&format=%E7%94%B5%E5%BD%B1&region=%E4%B8%AD%E5%9B%BD%E5%A4%A7%E9%99%86",
	}
	for _, path := range tests {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadGateway {
				t.Fatalf("expected 502, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestDoubanRecommendByFiltersRequiresKind(t *testing.T) {
	_, r := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/douban/recommend/filter", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDetailFetchesVideoSourceAndProbesEpisodes(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api.php/provide/vod":
			if r.URL.Query().Get("ids") != "101" {
				t.Fatalf("unexpected detail query: %s", r.URL.RawQuery)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"code": 1,
				"list": [{
					"vod_id": 101,
					"vod_name": "Detail Movie",
					"type_name": "movie",
					"vod_year": "2026",
					"vod_pic": "https://image.example/detail.jpg",
					"vod_blurb": "Short desc",
					"vod_content": "<p>Long desc</p>",
					"vod_director": "Director",
					"vod_actor": "Actor",
					"vod_area": "CN",
					"vod_play_url": "HD$` + upstream.URL + `/live/detail.m3u8"
				}]
			}`))
		case "/live/detail.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("#EXTM3U\n#EXTINF:10,\nseg.ts\n"))
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	h, r := setupTestHandler(t)
	h.sourceClient = vodsource.NewClient(upstream.Client())
	h.proxySvc = service.NewProxyServiceWithClient(upstream.Client())
	if _, err := h.store.CreateSource(&model.Source{
		Key:     "detail.example",
		Name:    "Detail Source",
		API:     upstream.URL + "/api.php/provide/vod",
		Enabled: true,
	}); err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/detail?source=detail.example&id=101", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var detail model.VideoDetail
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode detail: %v", err)
	}
	if detail.Title != "Detail Movie" || len(detail.Episodes) != 1 {
		t.Fatalf("unexpected detail: %+v", detail)
	}
}

func TestDetailBlocksAdultSourceForUnauthorizedUser(t *testing.T) {
	var upstreamRequests int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamRequests++
		_, _ = w.Write([]byte(`{"code":1,"list":[]}`))
	}))
	defer upstream.Close()

	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "adult_blocked_detail", "pw", "user")
	if _, err := h.store.CreateSource(&model.Source{
		Key:        "adult-detail.example",
		Name:       "Adult Detail",
		API:        upstream.URL + "/api.php/provide/vod",
		Enabled:    true,
		IsAdult:    true,
		Searchable: true,
	}); err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/detail?source=adult-detail.example&id=1", nil)
	req.Header.Set("Authorization", loginAndGetBearer(t, r, "adult_blocked_detail", "pw"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if upstreamRequests != 0 {
		t.Fatalf("adult detail should be blocked before upstream request, got %d requests", upstreamRequests)
	}
}

func TestDetailDirectModeSkipsCDNProbe(t *testing.T) {
	service.ApplyRuntimeSetting(consts.SettingPlaybackMode, consts.PlaybackModeDirect)
	t.Cleanup(func() {
		service.ApplyRuntimeSetting(consts.SettingPlaybackMode, consts.PlaybackModeProxy)
	})

	var probeRequests int
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api.php/provide/vod":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"code": 1,
				"list": [{
					"vod_id": 102,
					"vod_name": "Direct Detail Movie",
					"vod_play_url": "Line A$` + upstream.URL + `/live/a.m3u8$$$Line B$` + upstream.URL + `/live/b.m3u8"
				}]
			}`))
		case "/live/a.m3u8", "/live/b.m3u8":
			probeRequests++
			w.WriteHeader(http.StatusInternalServerError)
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	h, r := setupTestHandler(t)
	h.sourceClient = vodsource.NewClient(upstream.Client())
	h.proxySvc = service.NewProxyServiceWithClient(upstream.Client())
	if _, err := h.store.CreateSource(&model.Source{
		Key:     "detail-direct.example",
		Name:    "Detail Direct",
		API:     upstream.URL + "/api.php/provide/vod",
		Enabled: true,
	}); err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/detail?source=detail-direct.example&id=102", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if probeRequests != 0 {
		t.Fatalf("probe requests = %d, want 0 in direct playback mode", probeRequests)
	}
	var detail model.VideoDetail
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode detail: %v", err)
	}
	if len(detail.Episodes) != 2 {
		t.Fatalf("len(detail.Episodes) = %d, want 2 direct groups: %+v", len(detail.Episodes), detail.Episodes)
	}
}

func TestDetailErrorPaths(t *testing.T) {
	_, r := setupTestHandler(t)

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "missing source", path: "/api/v1/detail?id=1", status: http.StatusBadRequest},
		{name: "missing id", path: "/api/v1/detail?source=missing", status: http.StatusBadRequest},
		{name: "unknown source", path: "/api/v1/detail?source=missing&id=1", status: http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.status, rec.Body.String())
			}
		})
	}
}

func TestDetailUpstreamErrorMappings(t *testing.T) {
	tests := []struct {
		name string
		body string
		code int
		want string
	}{
		{name: "bad status", body: `blocked`, code: http.StatusForbidden, want: "source returned error"},
		{name: "invalid data", body: `{`, code: http.StatusOK, want: "source returned invalid data"},
		{name: "empty list", body: `{"code":1,"list":[]}`, code: http.StatusOK, want: "video not found"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.code)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer upstream.Close()

			h, r := setupTestHandler(t)
			h.sourceClient = vodsource.NewClient(upstream.Client())
			if _, err := h.store.CreateSource(&model.Source{
				Key:     "detail-error.example",
				Name:    "Detail Error",
				API:     upstream.URL + "/api.php/provide/vod",
				Enabled: true,
			}); err != nil {
				t.Fatalf("CreateSource error: %v", err)
			}

			req := httptest.NewRequest(http.MethodGet, "/api/v1/detail?source=detail-error.example&id=1", nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.want) {
				t.Fatalf("expected body to contain %q, got %s", tt.want, rec.Body.String())
			}
		})
	}
}

func TestProxyHandlers(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/live/index.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = w.Write([]byte("#EXTM3U\n#EXTINF:10,\nseg.ts\n"))
		case "/live/seg.ts", "/live/key.bin":
			w.Header().Set("Content-Type", "video/mp2t")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("segment-data"))
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	h, r := setupTestHandler(t)
	h.proxySvc = service.NewProxyServiceWithClient(upstream.Client())

	m3u8URL := upstream.URL + "/live/index.m3u8"
	target := url.QueryEscape(m3u8URL)
	mt := mediaToken(t, h, service.MediaKindM3U8, m3u8URL, "proxy-source")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/m3u8?url="+target+"&source=proxy-source&mt="+url.QueryEscape(mt), nil)
	req.Host = "kmtv.example"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "/api/v1/proxy/segment?url=") {
		t.Fatalf("expected rewritten segment URL: %s", rec.Body.String())
	}

	segmentURL := upstream.URL + "/live/seg.ts"
	target = url.QueryEscape(segmentURL)
	mt = mediaToken(t, h, service.MediaKindSegment, segmentURL, "")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/proxy/segment?url="+target+"&mt="+url.QueryEscape(mt), nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "segment-data" {
		t.Fatalf("unexpected segment response: status=%d body=%q", rec.Code, rec.Body.String())
	}

	keyURL := upstream.URL + "/live/key.bin"
	target = url.QueryEscape(keyURL)
	mt = mediaToken(t, h, service.MediaKindKey, keyURL, "")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/proxy/key?url="+target+"&mt="+url.QueryEscape(mt), nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "segment-data" {
		t.Fatalf("unexpected key response: status=%d body=%q", rec.Code, rec.Body.String())
	}

	tests := []struct {
		name string
		path string
		want int
	}{
		{name: "missing m3u8 url", path: "/api/v1/proxy/m3u8", want: http.StatusBadRequest},
		{name: "blocked m3u8 scheme", path: "/api/v1/proxy/m3u8?url=ftp%3A%2F%2Fexample.com%2Findex.m3u8", want: http.StatusForbidden},
		{name: "missing segment url", path: "/api/v1/proxy/segment", want: http.StatusBadRequest},
		{name: "blocked segment scheme", path: "/api/v1/proxy/segment?url=file%3A%2F%2F%2Fetc%2Fpasswd", want: http.StatusForbidden},
		{name: "missing key url", path: "/api/v1/proxy/key", want: http.StatusBadRequest},
		{name: "blocked key scheme", path: "/api/v1/proxy/key?url=javascript%3Aalert%281%29", want: http.StatusForbidden},
		{name: "missing segment token", path: "/api/v1/proxy/segment?url=https%3A%2F%2Fmedia.example%2Fa.ts", want: http.StatusUnauthorized},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.want, rec.Body.String())
			}
		})
	}
}

func TestPlaybackURLProxyModeReturnsTokenizedProxyURL(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "playback_admin", "pw", "admin")
	if _, err := h.store.CreateSource(&model.Source{
		Key:        "src",
		Name:       "Playback Source",
		API:        "https://source.example/api.php",
		Enabled:    true,
		Searchable: true,
	}); err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	body := strings.NewReader(`{"url":"https://media.example/index.m3u8","source":"src"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/playback/url", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "playback_admin"))
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "kmtv.example")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	if m["mode"] != "proxy" {
		t.Fatalf("mode = %v, want proxy", m["mode"])
	}
	gotURL, _ := m["url"].(string)
	if !strings.Contains(gotURL, "https://kmtv.example/api/v1/proxy/m3u8?") || !strings.Contains(gotURL, "&mt=") {
		t.Fatalf("expected tokenized proxy URL, got %q", gotURL)
	}
}

func TestPlaybackURLDirectModeReturnsUpstreamURL(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "playback_direct", "pw", "admin")
	if _, err := h.store.CreateSource(&model.Source{
		Key:        "src",
		Name:       "Playback Source",
		API:        "https://source.example/api.php",
		Enabled:    true,
		Searchable: true,
	}); err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	t.Cleanup(func() {
		service.ApplyRuntimeSetting(consts.SettingPlaybackMode, consts.PlaybackModeProxy)
	})
	if err := h.store.SetSetting(consts.SettingPlaybackMode, consts.PlaybackModeDirect); err != nil {
		t.Fatalf("SetSetting playback_mode: %v", err)
	}
	service.ApplyRuntimeSetting(consts.SettingPlaybackMode, consts.PlaybackModeDirect)

	body := strings.NewReader(`{"url":"https://media.example/index.m3u8","source":"src"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/playback/url", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "playback_direct"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	if m["mode"] != "direct" || m["url"] != "https://media.example/index.m3u8" {
		t.Fatalf("unexpected direct response: %+v", m)
	}
}

func TestPlaybackURLAdultAccessPolicy(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	if _, err := h.store.CreateSource(&model.Source{
		Key:        "adult-playback.example",
		Name:       "Adult Playback",
		API:        "https://source.example/api.php",
		Enabled:    true,
		IsAdult:    true,
		Searchable: true,
	}); err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	createTestUser(t, h, "adult_blocked_playback", "pw", "user")
	if _, err := h.store.CreateUserWithAdultAccess("adult_allowed_playback", "pw", "user", true); err != nil {
		t.Fatalf("CreateUserWithAdultAccess error: %v", err)
	}

	body := `{"url":"https://media.example/index.m3u8","source":"adult-playback.example"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/playback/url", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", loginAndGetBearer(t, r, "adult_blocked_playback", "pw"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("blocked user expected 403, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/playback/url", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", loginAndGetBearer(t, r, "adult_allowed_playback", "pw"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("global filter enabled expected 403, got %d: %s", rec.Code, rec.Body.String())
	}

	if err := h.store.SetSetting(consts.SettingNSFWFilterEnabled, "false"); err != nil {
		t.Fatalf("SetSetting nsfw_filter_enabled: %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/playback/url", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", loginAndGetBearer(t, r, "adult_allowed_playback", "pw"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("global filter disabled and allowed user expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestProxyRejectsAdultMediaWhenGlobalFilterEnabled(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	if _, err := h.store.CreateSource(&model.Source{
		Key:        "adult-proxy.example",
		Name:       "Adult Proxy",
		API:        "https://source.example/api.php",
		Enabled:    true,
		IsAdult:    true,
		Searchable: true,
	}); err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	userID, err := h.store.CreateUserWithAdultAccess("adult_allowed_proxy", "pw", "user", true)
	if err != nil {
		t.Fatalf("CreateUserWithAdultAccess error: %v", err)
	}
	user, err := h.store.GetUserByID(userID)
	if err != nil {
		t.Fatalf("GetUserByID error: %v", err)
	}
	issued, err := h.authSvc.IssueAccessToken(user, time.Hour, "test", "127.0.0.1")
	if err != nil {
		t.Fatalf("IssueAccessToken error: %v", err)
	}
	rawURL := "https://media.example/seg.ts"
	token, err := h.mediaSvc.IssueMediaToken(issued.SessionID, service.MediaKindSegment, rawURL, "adult-proxy.example", time.Minute)
	if err != nil {
		t.Fatalf("IssueMediaToken error: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/segment?url="+url.QueryEscape(rawURL)+"&source=adult-proxy.example&mt="+url.QueryEscape(token), nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("global filter enabled adult proxy expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPlaybackURLErrorPaths(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "playback_errors", "pw", "admin")
	bearer := adminBearer(t, h, "playback_errors")

	tests := []struct {
		name   string
		body   string
		auth   string
		status int
	}{
		{name: "missing auth", body: `{"url":"https://media.example/index.m3u8"}`, status: http.StatusUnauthorized},
		{name: "bad json", body: `{`, auth: bearer, status: http.StatusBadRequest},
		{name: "blocked url", body: `{"url":"file:///tmp/index.m3u8"}`, auth: bearer, status: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/playback/url", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			if tt.auth != "" {
				req.Header.Set("Authorization", tt.auth)
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.status, rec.Body.String())
			}
		})
	}
}

func TestProxyMediaTokenRejectsWrongKindAndURL(t *testing.T) {
	h, r := setupTestHandler(t)
	rawURL := "https://media.example/a.ts"
	token := mediaToken(t, h, service.MediaKindKey, rawURL, "")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/segment?url="+url.QueryEscape(rawURL)+"&mt="+url.QueryEscape(token), nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong kind expected 401, got %d: %s", rec.Code, rec.Body.String())
	}

	segmentToken := mediaToken(t, h, service.MediaKindSegment, rawURL, "")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/proxy/segment?url="+url.QueryEscape("https://media.example/b.ts")+"&mt="+url.QueryEscape(segmentToken), nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong URL expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSchemeAndHost(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "https://origin.example/path", nil)
	req.Host = "origin.example"
	if got := scheme(req); got != "https" {
		t.Fatalf("scheme with TLS = %q, want https", got)
	}
	if got := host(req); got != "origin.example" {
		t.Fatalf("host = %q, want origin.example", got)
	}
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "public.example")
	if got := scheme(req); got != "https" {
		t.Fatalf("forwarded scheme = %q, want https", got)
	}
	if got := host(req); got != "public.example" {
		t.Fatalf("forwarded host = %q, want public.example", got)
	}
}

func TestProxyM3U8UsesConfiguredPublicBaseURL(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		_, _ = w.Write([]byte("#EXTM3U\n#EXTINF:10,\nseg.ts\n"))
	}))
	defer upstream.Close()

	tests := []struct {
		name      string
		envValue  string
		dbValue   string
		wantBase  string
		wantOther string
	}{
		{
			name:      "env overrides db and forwarded",
			envValue:  "https://env.example/base/",
			dbValue:   "https://db.example",
			wantBase:  "https://env.example/base",
			wantOther: "https://db.example",
		},
		{
			name:      "db overrides forwarded",
			dbValue:   "https://db.example/base/",
			wantBase:  "https://db.example/base",
			wantOther: "https://forwarded.example",
		},
		{
			name:     "fallback uses current forwarded behavior",
			wantBase: "https://forwarded.example",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(consts.EnvPublicBaseURL, tt.envValue)
			h, r := setupTestHandler(t)
			h.proxySvc = service.NewProxyServiceWithClient(upstream.Client())
			if tt.dbValue != "" {
				if err := h.store.SetSetting(consts.SettingPublicBaseURL, tt.dbValue); err != nil {
					t.Fatalf("SetSetting public_base_url: %v", err)
				}
			}

			m3u8URL := upstream.URL + "/live/index.m3u8"
			target := url.QueryEscape(m3u8URL)
			mt := mediaToken(t, h, service.MediaKindM3U8, m3u8URL, "proxy-source")
			req := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/m3u8?url="+target+"&source=proxy-source&mt="+url.QueryEscape(mt), nil)
			req.Header.Set("X-Forwarded-Proto", "https")
			req.Header.Set("X-Forwarded-Host", "forwarded.example")
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
			}
			body := rec.Body.String()
			if !strings.Contains(body, tt.wantBase+"/api/v1/proxy/segment?url=") {
				t.Fatalf("expected proxy base %q in body:\n%s", tt.wantBase, body)
			}
			if tt.wantOther != "" && strings.Contains(body, tt.wantOther+"/api/v1/proxy/segment?url=") {
				t.Fatalf("unexpected lower-priority proxy base %q in body:\n%s", tt.wantOther, body)
			}
		})
	}
}

func TestProxyImageUsesDoubanWhitelist(t *testing.T) {
	h, r := setupTestHandler(t)
	h.imageClient = &http.Client{Transport: serviceRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "img1.doubanio.com" {
			t.Fatalf("unexpected image host: %s", req.URL.Host)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/jpeg"}},
			Body:       io.NopCloser(strings.NewReader("jpeg-data")),
		}, nil
	})}

	target := url.QueryEscape("https://img1.doubanio.com/view/photo/test.jpg")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/image?url="+target, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "jpeg-data" {
		t.Fatalf("unexpected image response: status=%d body=%q", rec.Code, rec.Body.String())
	}

	target = url.QueryEscape("https://example.com/test.jpg")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/proxy/image?url="+target, nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-Douban image host, got %d", rec.Code)
	}
}

func TestProxyImageErrorPaths(t *testing.T) {
	h, r := setupTestHandler(t)
	h.imageClient = &http.Client{Transport: serviceRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusBadGateway,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader("bad gateway")),
		}, nil
	})}

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{name: "missing URL", path: "/api/v1/proxy/image", status: http.StatusBadRequest},
		{name: "invalid URL", path: "/api/v1/proxy/image?url=%3A%2F%2Fbad", status: http.StatusBadRequest},
		{name: "upstream bad status", path: "/api/v1/proxy/image?url=https%3A%2F%2Fimg1.doubanio.com%2Fbad.jpg", status: http.StatusBadGateway},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.status, rec.Body.String())
			}
		})
	}
}

func TestRegisterStaticRoutes(t *testing.T) {
	r := gin.New()
	distFS, err := fs.Sub(testFrontendFS, "testdata/static")
	if err != nil {
		t.Fatalf("static fixture sub FS: %v", err)
	}
	registerStaticRoutesFromFS(r, distFS)

	req := httptest.NewRequest(http.MethodGet, "/fixture.js", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "kmtv static fixture") {
		t.Fatalf("unexpected asset response: status=%d body=%q", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/missing-route", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "KMTV static fixture") {
		t.Fatalf("unexpected SPA fallback: status=%d body=%q", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/not-found", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "not found") {
		t.Fatalf("unexpected API fallback: status=%d body=%q", rec.Code, rec.Body.String())
	}
}

func TestRegisterStaticRoutesSkipsMissingEmbeddedWebDist(t *testing.T) {
	r := gin.New()
	RegisterStaticRoutes(r, testFrontendFS)

	req := httptest.NewRequest(http.MethodGet, "/fixture.js", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("RegisterStaticRoutes should not register routes when web/dist is missing, got %d", rec.Code)
	}
}

type serviceRoundTripFunc func(*http.Request) (*http.Response, error)

func (f serviceRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func testStringResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func recentHotHandlerBody(id, title, rating string) string {
	return `{"items":[{"id":"` + id + `","title":"` + title + `","card_subtitle":"2026 / 中国大陆","pic":{"normal":"https://img1.doubanio.com/` + id + `.jpg"},"rating":{"value":` + rating + `}}]}`
}

func recommendHandlerBody(id, title, kind, rating string) string {
	return `{"items":[{"id":"` + id + `","title":"` + title + `","type":"` + kind + `","year":"2026","pic":{"normal":"https://img1.doubanio.com/` + id + `.jpg"},"rating":{"value":` + rating + `}}]}`
}

func TestDoubanList_InvalidCategory(t *testing.T) {
	_, r := setupTestHandler(t)

	// Category validation was removed; any category string is accepted.
	// Without a valid type param the handler still returns 400.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/douban/list?category=INVALID", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateSettings_InvalidKey(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_ik", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		"unknown_key": "value",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_ik"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	errMsg, ok := m["error"].(string)
	if !ok || errMsg != "unknown setting key: unknown_key" {
		t.Errorf("expected error about unknown setting key, got %v", m["error"])
	}
}

func TestHandlerStoreErrorBranches(t *testing.T) {
	h, _ := setupTestHandler(t)
	if err := h.store.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	r := gin.New()
	r.GET("/sources", h.ListSources)
	r.GET("/subscriptions", h.ListSubscriptions)
	r.GET("/users", h.ListUsers)
	r.GET("/settings", h.GetSettings)
	r.PUT("/settings", h.UpdateSettings)
	r.POST("/sources", h.CreateSource)
	r.PUT("/sources/:id", h.UpdateSource)
	r.DELETE("/sources/:id", h.DeleteSource)
	r.POST("/sources/:id/check", h.CheckSource)
	r.POST("/subscriptions", h.CreateSubscription)
	r.PUT("/subscriptions/:id", h.UpdateSubscription)
	r.DELETE("/subscriptions/:id", h.DeleteSubscription)
	r.POST("/users", h.CreateUser)
	r.PUT("/users/:id", h.UpdateUser)
	r.DELETE("/users/:id", h.DeleteUser)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list sources", method: http.MethodGet, path: "/sources"},
		{name: "list subscriptions", method: http.MethodGet, path: "/subscriptions"},
		{name: "list users", method: http.MethodGet, path: "/users"},
		{name: "get settings", method: http.MethodGet, path: "/settings"},
		{name: "update settings", method: http.MethodPut, path: "/settings", body: `{"site_name":"x"}`},
		{name: "create source", method: http.MethodPost, path: "/sources", body: `{"key":"closed","name":"Closed","api":"https://closed.example/api"}`},
		{name: "update source", method: http.MethodPut, path: "/sources/1", body: `{"name":"Closed","api":"https://closed.example/api"}`},
		{name: "delete source", method: http.MethodDelete, path: "/sources/1"},
		{name: "check source", method: http.MethodPost, path: "/sources/1/check"},
		{name: "create subscription", method: http.MethodPost, path: "/subscriptions", body: `{"url":"https://closed.example/config.json"}`},
		{name: "update subscription", method: http.MethodPut, path: "/subscriptions/1", body: `{"url":"https://closed.example/config.json"}`},
		{name: "delete subscription", method: http.MethodDelete, path: "/subscriptions/1"},
		{name: "create user", method: http.MethodPost, path: "/users", body: `{"username":"closed_user","password":"password","role":"user"}`},
		{name: "update user", method: http.MethodPut, path: "/users/1", body: `{"username":"closed_user","role":"admin"}`},
		{name: "delete user", method: http.MethodDelete, path: "/users/1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500: %s", rec.Code, rec.Body.String())
			}
		})
	}
}
