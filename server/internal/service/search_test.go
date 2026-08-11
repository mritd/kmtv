package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/vodsource"
)

func TestBuildVideoSourceSearchURL(t *testing.T) {
	tests := []struct {
		name   string
		apiURL string
		query  string
		page   int
		want   string
	}{
		{
			name:   "basic URL",
			apiURL: "https://api.example.com/api.php/provide/vod",
			query:  "test",
			page:   1,
			want:   "https://api.example.com/api.php/provide/vod?ac=videolist&wd=test&pg=1",
		},
		{
			name:   "URL with existing query params",
			apiURL: "https://api.example.com/api.php?key=val",
			query:  "test",
			page:   2,
			want:   "https://api.example.com/api.php?key=val&ac=videolist&wd=test&pg=2",
		},
		{
			name:   "query with spaces",
			apiURL: "https://api.example.com/api",
			query:  "hello world",
			page:   1,
			want:   "https://api.example.com/api?ac=videolist&wd=hello+world&pg=1",
		},
		{
			name:   "query with CJK characters",
			apiURL: "https://api.example.com/api",
			query:  "test movie",
			page:   3,
			want:   "https://api.example.com/api?ac=videolist&wd=test+movie&pg=3",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildVideoSourceSearchURL(tt.apiURL, tt.query, tt.page)
			if got != tt.want {
				t.Errorf("buildVideoSourceSearchURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSearchProbeConcurrencyLimitUsesProbeSetting(t *testing.T) {
	SetSearchConcurrency(1)
	SetProbeConcurrency(7)
	t.Cleanup(func() {
		SetSearchConcurrency(consts.DefaultSearchConcurrency)
		SetProbeConcurrency(consts.DefaultProbeConcurrency)
	})

	if got := searchProbeConcurrencyLimit(); got != 7 {
		t.Fatalf("searchProbeConcurrencyLimit() = %d, want probe concurrency 7", got)
	}
}

func TestMergeRankSearchResults(t *testing.T) {
	// 3 raw results: 2 with same title+year, 1 different
	raw := []rawSearchResult{
		{
			SourceKey:  "source-a",
			SourceName: "Source A",
			Duration:   150,
			Item:       videoSourceItem("The Matrix", "1999", 101, "action", "cover1.jpg", "A computer hacker...", "ep1$url1#ep2$url2"),
		},
		{
			SourceKey:  "source-b",
			SourceName: "Source B",
			Duration:   200,
			Item:       videoSourceItem("The Matrix", "1999", 202, "action", "cover2.jpg", "A computer hacker learns...", "ep1$url3"),
		},
		{
			SourceKey:  "source-c",
			SourceName: "Source C",
			Duration:   100,
			Item:       videoSourceItem("Inception", "2010", 303, "sci-fi", "cover3.jpg", "A thief who steals...", "ep1$url4"),
		},
	}

	entries := mergeSearchResults(raw)
	rankSearchEntries("", entries)
	results := searchEntriesToResults(entries)

	if len(results) != 2 {
		t.Fatalf("expected 2 deduplicated results, got %d", len(results))
	}

	// First result should be "The Matrix" (2 sources, sorted by count desc)
	if results[0].Title != "The Matrix" {
		t.Errorf("expected first result to be 'The Matrix', got %q", results[0].Title)
	}
	if len(results[0].Sources) != 2 {
		t.Errorf("expected 2 sources for 'The Matrix', got %d", len(results[0].Sources))
	}

	// Second result should be "Inception" (1 source)
	if results[1].Title != "Inception" {
		t.Errorf("expected second result to be 'Inception', got %q", results[1].Title)
	}
	if len(results[1].Sources) != 1 {
		t.Errorf("expected 1 source for 'Inception', got %d", len(results[1].Sources))
	}

	// Verify source details
	foundA := false
	foundB := false
	for _, sr := range results[0].Sources {
		if sr.SourceKey == "source-a" {
			foundA = true
			if sr.VideoID != "101" {
				t.Errorf("expected VideoID 101, got %s", sr.VideoID)
			}
		}
		if sr.SourceKey == "source-b" {
			foundB = true
			if sr.VideoID != "202" {
				t.Errorf("expected VideoID 202, got %s", sr.VideoID)
			}
		}
	}
	if !foundA || !foundB {
		t.Error("expected both source-a and source-b in merged result")
	}
}

func TestRankSearchEntriesRelevanceBeatsSourceCount(t *testing.T) {
	entries := mergeSearchResults([]rawSearchResult{
		rawSearchFixture("source-a", "Source A", false, 10, "Unrelated Popular", "2024", 101, "", ""),
		rawSearchFixture("source-b", "Source B", false, 20, "Unrelated Popular", "2024", 102, "", ""),
		rawSearchFixture("source-c", "Source C", false, 30, "Unrelated Popular", "2024", 103, "", ""),
		rawSearchFixture("source-d", "Source D", false, 100, "The Matrix", "1999", 201, "", ""),
	})

	rankSearchEntries("The Matrix", entries)
	results := searchEntriesToResults(entries)

	if got := results[0].Title; got != "The Matrix" {
		t.Fatalf("first title = %q, want relevant single-source result before unrelated multi-source result", got)
	}
	if got := len(results[1].Sources); got != 3 {
		t.Fatalf("second result source count = %d, want unrelated merged result with 3 sources", got)
	}
}

func TestRankSearchEntriesTiers(t *testing.T) {
	entries := mergeSearchResults([]rawSearchResult{
		rawSearchFixture("source-a", "Source A", false, 10, "Matric", "2024", 101, "", ""),
		rawSearchFixture("source-b", "Source B", false, 10, "The Matrix", "1999", 102, "", ""),
		rawSearchFixture("source-c", "Source C", false, 10, "Matrix Reloaded", "2003", 103, "", ""),
	})

	rankSearchEntries("matrix", entries)
	results := searchEntriesToResults(entries)

	assertSearchTitles(t, results, []string{"Matrix Reloaded", "The Matrix", "Matric"})
}

func TestRankSearchEntriesEqualRelevanceQualityTies(t *testing.T) {
	t.Run("fastest duration breaks exact-tier ties before lower tiers", func(t *testing.T) {
		entries := mergeSearchResults([]rawSearchResult{
			rawSearchFixture("source-a", "Source A", false, 30, "THE MATRIX", "1999", 101, "", ""),
			rawSearchFixture("source-b", "Source B", false, 100, "The-Matrix", "1999", 201, "", ""),
			rawSearchFixture("source-c", "Source C", false, 90, "The-Matrix", "1999", 202, "", ""),
			rawSearchFixture("source-d", "Source D", false, 10, "The Matrix", "1999", 301, "", ""),
		})

		rankSearchEntries("the matrix", entries)
		results := searchEntriesToResults(entries)

		assertSearchTitles(t, results, []string{"The Matrix", "THE MATRIX", "The-Matrix"})
	})

	t.Run("stable original order", func(t *testing.T) {
		entries := mergeSearchResults([]rawSearchResult{
			rawSearchFixture("source-a", "Source A", false, 50, "The-Matrix", "1999", 101, "", ""),
			rawSearchFixture("source-b", "Source B", false, 50, "THE MATRIX", "1999", 201, "", ""),
		})

		rankSearchEntries("the matrix", entries)
		results := searchEntriesToResults(entries)

		assertSearchTitles(t, results, []string{"THE MATRIX", "The-Matrix"})
	})
}

func TestMergeSearchResultsPreservesInternalTitleVariants(t *testing.T) {
	entries := mergeSearchResults([]rawSearchResult{
		rawSearchFixture("source-a", "Source A", false, 50, "庆余年第二季", "2024", 101, "", ""),
		rawSearchFixture("source-b", "Source B", false, 40, "庆余年 第二季", "2024", 201, "", ""),
		rawSearchFixture("source-b", "Source B Duplicate", false, 1, "庆余年　第二季", "2024", 202, "", ""),
		rawSearchFixture("source-c", "Source C", false, 30, "庆余年:第二季", "2024", 301, "", ""),
	})
	results := searchEntriesToResults(entries)

	assertSearchTitles(t, results, []string{"庆余年第二季", "庆余年 第二季", "庆余年　第二季", "庆余年:第二季"})
	for _, result := range results {
		if got := len(result.Sources); got != 1 {
			t.Fatalf("result %q source count = %d, want 1: %+v", result.Title, got, result.Sources)
		}
	}
}

func TestMergeSearchResultsSourceIdentityFallbacks(t *testing.T) {
	t.Run("duplicate provider can fill empty description", func(t *testing.T) {
		entries := mergeSearchResults([]rawSearchResult{
			rawSearchFixture("source-a", "Source A", false, 50, "Same Provider", "2026", 101, "", ""),
			rawSearchFixture("source-a", "Source A Duplicate", false, 1, "Same Provider", "2026", 102, " Later duplicate desc. ", ""),
		})
		results := searchEntriesToResults(entries)

		if got := len(results[0].Sources); got != 1 {
			t.Fatalf("source count = %d, want one retained provider source: %+v", got, results[0].Sources)
		}
		if got := results[0].Sources[0].VideoID; got != "101" {
			t.Fatalf("retained video id = %q, want first provider variant 101", got)
		}
		if got := results[0].Desc; got != "Later duplicate desc." {
			t.Fatalf("desc = %q, want later duplicate provider desc", got)
		}
	})

	t.Run("empty source key remains one provider identity", func(t *testing.T) {
		entries := mergeSearchResults([]rawSearchResult{
			rawSearchFixture("", "", false, 50, "Empty Source", "2026", 101, "", ""),
			rawSearchFixture("", "", false, 40, "Empty Source", "2026", 102, "", ""),
			rawSearchFixture("", "", false, 1, "Empty Source", "2026", 102, "", ""),
		})
		results := searchEntriesToResults(entries)

		if got := len(results[0].Sources); got != 1 {
			t.Fatalf("empty source-key source count = %d, want one selectable provider identity: %+v", got, results[0].Sources)
		}
		if got := results[0].Sources[0].VideoID; got != "101" {
			t.Fatalf("first empty-key video id = %q, want 101", got)
		}
	})
}

func TestFilterAdultSearchEntriesRecomputesQualityTies(t *testing.T) {
	entries := mergeSearchResults([]rawSearchResult{
		rawSearchFixture("adult-fast", "Adult Fast", true, 1, "Adult Boosted", "2026", 101, "", ""),
		rawSearchFixture("clean-slow", "Clean Slow", false, 200, "Adult Boosted", "2026", 102, "", ""),
		rawSearchFixture("clean-fast", "Clean Fast", false, 20, "Clean Result", "2026", 201, "", ""),
		rawSearchFixture("adult-only", "Adult Only", true, 1, "Adult Only", "2026", 301, "", ""),
	})

	entries = filterAdultSearchEntries(entries)
	rankSearchEntries("", entries)
	results := searchEntriesToResults(entries)

	assertSearchTitles(t, results, []string{"Clean Result", "Adult Boosted"})
	if len(results[1].Sources) != 1 || results[1].Sources[0].SourceKey != "clean-slow" {
		t.Fatalf("adult-filtered sources = %+v, want only clean-slow retained", results[1].Sources)
	}
}

func TestMergeRankSearchResultsPreservesSourcesOrder(t *testing.T) {
	entries := mergeSearchResults([]rawSearchResult{
		rawSearchFixture("source-slow", "Source Slow", false, 100, "The Matrix", "1999", 101, "", ""),
		rawSearchFixture("source-fast", "Source Fast", false, 1, "The Matrix", "1999", 102, "", ""),
	})

	rankSearchEntries("matrix", entries)
	results := searchEntriesToResults(entries)

	got := []string{results[0].Sources[0].SourceKey, results[0].Sources[1].SourceKey}
	want := []string{"source-slow", "source-fast"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("source order = %v, want %v", got, want)
		}
	}
}

func TestRankSearchEntriesMalformedDurationSortsLast(t *testing.T) {
	tests := []struct {
		name     string
		duration float64
	}{
		{name: "negative", duration: -1},
		{name: "nan", duration: math.NaN()},
		{name: "positive infinity", duration: math.Inf(1)},
		{name: "negative infinity", duration: math.Inf(-1)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			entries := mergeSearchResults([]rawSearchResult{
				rawSearchFixture("bad", "Bad", false, tt.duration, "The-Matrix", "1999", 101, "", ""),
				rawSearchFixture("good", "Good", false, 25, "THE MATRIX", "1999", 201, "", ""),
			})

			rankSearchEntries("the matrix", entries)
			results := searchEntriesToResults(entries)

			assertSearchTitles(t, results, []string{"THE MATRIX", "The-Matrix"})
		})
	}
}

func TestMergeSearchResultsDescriptionFallback(t *testing.T) {
	t.Run("later blurb fills empty first description", func(t *testing.T) {
		entries := mergeSearchResults([]rawSearchResult{
			rawSearchFixture("source-a", "Source A", false, 10, "The Matrix", "1999", 101, "", ""),
			rawSearchFixture("source-b", "Source B", false, 20, "The Matrix", "1999", 102, " Later blurb. ", "<p>Later content.</p>"),
		})
		results := searchEntriesToResults(entries)

		if got := results[0].Desc; got != "Later blurb." {
			t.Fatalf("Desc = %q, want later blurb fallback", got)
		}
	})

	t.Run("later cleaned content fills empty first description", func(t *testing.T) {
		entries := mergeSearchResults([]rawSearchResult{
			rawSearchFixture("source-a", "Source A", false, 10, "Inception", "2010", 101, "", ""),
			rawSearchFixture("source-b", "Source B", false, 20, "Inception", "2010", 102, "", "<p>Later content.</p>"),
		})
		results := searchEntriesToResults(entries)

		if got := results[0].Desc; got != "Later content." {
			t.Fatalf("Desc = %q, want later cleaned content fallback", got)
		}
	})
}

func TestSearchWithProgress_RealHTTPSource(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api.php/provide/vod":
			if r.URL.Query().Get("wd") != "mat  rix" || r.URL.Query().Get("ac") != "videolist" {
				t.Fatalf("unexpected search query: %s", r.URL.RawQuery)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{
				"code": 1,
				"list": [{
					"vod_id": 101,
					"vod_name": "The Matrix",
					"type_name": "movie",
					"vod_year": "1999",
					"vod_pic": "https://image.example/matrix.jpg",
					"vod_blurb": "A hacker learns the truth.",
					"vod_play_url": "HD$%s/live/matrix.m3u8"
				}]
			}`, upstream.URL)
		case "/live/matrix.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("#EXTM3U\n#EXTINF:10,\nseg.ts\n"))
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	s := newSearchServiceTestStore(t)
	id, err := s.CreateSource(&model.Source{
		Key:        "real-http.example",
		Name:       "Real HTTP",
		API:        upstream.URL + "/api.php/provide/vod",
		Enabled:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	if err := s.UpdateSourceHealth(id, consts.HealthHealthy); err != nil {
		t.Fatalf("UpdateSourceHealth error: %v", err)
	}

	ps := NewProxyService()
	ps.client = upstream.Client()
	ss := NewSearchService(s, ps)
	ss.sourceClient = vodsource.NewClient(upstream.Client())
	var progress []string
	results, err := ss.SearchWithProgress(context.Background(), "  mat  rix  ", 1, false, func(phase string, completed, total int) {
		progress = append(progress, fmt.Sprintf("%s:%d/%d", phase, completed, total))
	})
	if err != nil {
		t.Fatalf("SearchWithProgress error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("len(results) = %d, want 1: %+v", len(results), results)
	}
	if results[0].Title != "The Matrix" || len(results[0].Sources) != 1 {
		t.Fatalf("unexpected search result: %+v", results[0])
	}
	if len(results[0].Sources[0].Episodes) != 1 || results[0].Sources[0].Episodes[0].URL != upstream.URL+"/live/matrix.m3u8" {
		t.Fatalf("unexpected episodes: %+v", results[0].Sources[0].Episodes)
	}
	if len(progress) == 0 {
		t.Fatal("expected progress callbacks")
	}
}

func TestSearchWithProgressDirectModeSkipsCDNProbe(t *testing.T) {
	ApplyRuntimeSetting(consts.SettingPlaybackMode, consts.PlaybackModeDirect)
	t.Cleanup(func() {
		ApplyRuntimeSetting(consts.SettingPlaybackMode, consts.PlaybackModeProxy)
	})

	var probeRequests int
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api.php/provide/vod":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{
				"code": 1,
				"list": [{
					"vod_id": 102,
					"vod_name": "Direct Movie",
					"type_name": "movie",
					"vod_year": "2026",
					"vod_play_url": "HD$%s/live/direct.m3u8"
				}]
			}`, upstream.URL)
		case "/live/direct.m3u8":
			probeRequests++
			w.WriteHeader(http.StatusInternalServerError)
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	s := newSearchServiceTestStore(t)
	id, err := s.CreateSource(&model.Source{
		Key:        "direct-search.example",
		Name:       "Direct Search",
		API:        upstream.URL + "/api.php/provide/vod",
		Enabled:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	if err := s.UpdateSourceHealth(id, consts.HealthHealthy); err != nil {
		t.Fatalf("UpdateSourceHealth error: %v", err)
	}

	ps := NewProxyServiceWithClient(upstream.Client())
	ss := NewSearchServiceWithClient(s, ps, upstream.Client())
	results, err := ss.Search(context.Background(), "direct", 1, false)
	if err != nil {
		t.Fatalf("Search error: %v", err)
	}
	if probeRequests != 0 {
		t.Fatalf("probe requests = %d, want 0 in direct playback mode", probeRequests)
	}
	if len(results) != 1 || len(results[0].Sources) != 1 {
		t.Fatalf("unexpected direct search result: %+v", results)
	}
	if got := results[0].Sources[0].Episodes[0].URL; got != upstream.URL+"/live/direct.m3u8" {
		t.Fatalf("episode URL = %q, want direct upstream URL", got)
	}
}

func TestSearchWithProgress_DisablesSourceWhenSearchUnsupported(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("暂不支持搜索"))
	}))
	defer upstream.Close()

	s := newSearchServiceTestStore(t)
	id, err := s.CreateSource(&model.Source{
		Key:        "disabled.example",
		Name:       "Disabled",
		API:        upstream.URL + "/api.php/provide/vod",
		Enabled:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	if err := s.UpdateSourceHealth(id, consts.HealthHealthy); err != nil {
		t.Fatalf("UpdateSourceHealth error: %v", err)
	}

	ps := NewProxyService()
	ps.client = upstream.Client()
	ss := NewSearchService(s, ps)
	ss.sourceClient = vodsource.NewClient(upstream.Client())
	results, err := ss.Search(context.Background(), "anything", 1, false)
	if err != nil {
		t.Fatalf("Search error: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("len(results) = %d, want 0", len(results))
	}
	src, err := s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID error: %v", err)
	}
	if src.Searchable {
		t.Fatal("expected source to be marked searchable=false")
	}
}

func TestSearchServiceConstructorWithNilClient(t *testing.T) {
	s := newSearchServiceTestStore(t)
	ss := NewSearchServiceWithClient(s, NewProxyService(), nil)
	if ss.sourceClient == nil {
		t.Fatal("expected fallback video-source client")
	}
}

func TestSearchWithProgressReturnsNilWhenNoSourcesRemain(t *testing.T) {
	s := newSearchServiceTestStore(t)
	ss := NewSearchService(s, NewProxyService())

	results, err := ss.Search(context.Background(), "empty", 1, false)
	if err != nil {
		t.Fatalf("Search error: %v", err)
	}
	if results != nil {
		t.Fatalf("results = %#v, want nil for no sources", results)
	}

	id, err := s.CreateSource(&model.Source{
		Key:        "adult.example",
		Name:       "18禁 Adult",
		API:        "https://adult.example/api.php",
		Enabled:    true,
		IsAdult:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	if err := s.UpdateSourceHealth(id, consts.HealthHealthy); err != nil {
		t.Fatalf("UpdateSourceHealth error: %v", err)
	}

	results, err = ss.Search(context.Background(), "filtered", 1, true)
	if err != nil {
		t.Fatalf("Search with adult filter error: %v", err)
	}
	if results != nil {
		t.Fatalf("results = %#v, want nil after adult source filtering", results)
	}
}

func TestSearchWithProgressStoreListFailure(t *testing.T) {
	s := newSearchServiceTestStore(t)
	ss := NewSearchService(s, NewProxyService())
	if err := s.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	if _, err := ss.Search(context.Background(), "matrix", 1, false); err == nil {
		t.Fatal("expected list sources failure after store close")
	}
}

func TestSearchWithProgressSkipsEmptyPlayURLAndDeadCDN(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api.php/provide/vod":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{
				"code": 1,
				"list": [
					{"vod_id": 1, "vod_name": "No Play URL", "vod_year": "2026", "vod_play_url": ""},
					{"vod_id": 2, "vod_name": "Dead CDN", "vod_year": "2026", "vod_play_url": "HD$%s/dead.m3u8"}
				]
			}`, upstream.URL)
		case "/dead.m3u8":
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html>blocked</html>"))
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	s := newSearchServiceTestStore(t)
	id, err := s.CreateSource(&model.Source{
		Key:        "dead-cdn.example",
		Name:       "Dead CDN",
		API:        upstream.URL + "/api.php/provide/vod",
		Enabled:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	if err := s.UpdateSourceHealth(id, consts.HealthHealthy); err != nil {
		t.Fatalf("UpdateSourceHealth error: %v", err)
	}

	ps := NewProxyServiceWithClient(upstream.Client())
	ss := NewSearchServiceWithClient(s, ps, upstream.Client())
	results, err := ss.Search(context.Background(), "dead", 1, false)
	if err != nil {
		t.Fatalf("Search error: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("len(results) = %d, want 0 after empty play URL and dead CDN", len(results))
	}
}

func TestLogSearchFetchErrorWithBody(t *testing.T) {
	logSearchFetchError("source-a", "https://source.example/api?wd=test", "not json", errors.New("decode failed"))
}

func rawSearchFixture(sourceKey, sourceName string, isAdult bool, duration float64, title, year string, id int, blurb, content string) rawSearchResult {
	return rawSearchResult{
		SourceKey:  sourceKey,
		SourceName: sourceName,
		IsAdult:    isAdult,
		Duration:   duration,
		Item: model.VideoSourceItem{
			VodID:      id,
			VodName:    title,
			VodYear:    year,
			TypeName:   "movie",
			VodPic:     "cover.jpg",
			VodBlurb:   blurb,
			VodContent: content,
			VodPlayURL: "ep1$url1",
		},
		Episodes: []model.Episode{{Name: "ep1", URL: "url1"}},
	}
}

func assertSearchTitles(t *testing.T, results []model.SearchResult, want []string) {
	t.Helper()
	if len(results) != len(want) {
		t.Fatalf("len(results) = %d, want %d: %+v", len(results), len(want), results)
	}
	for i, title := range want {
		if results[i].Title != title {
			t.Fatalf("results[%d].Title = %q, want %q; all results: %+v", i, results[i].Title, title, results)
		}
	}
}

// videoSourceItem is a test helper to create a VideoSourceItem.
func videoSourceItem(name, year string, id int, typeName, pic, blurb, playURL string) model.VideoSourceItem {
	return model.VideoSourceItem{
		VodID:      id,
		VodName:    name,
		VodYear:    year,
		TypeName:   typeName,
		VodPic:     pic,
		VodBlurb:   blurb,
		VodPlayURL: playURL,
	}
}

func newSearchServiceTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}
