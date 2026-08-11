package handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/vodsource"
)

// TestSearch_EmptyResultsIsArray guards that GET /search returns "results": [] (never null)
// when no sources are configured. The service returns a nil slice for zero sources, and a
// null here crashes clients that call array methods on the field (e.g. DetailPage's recovery search).
//
// TestSearch_EmptyResultsIsArray 确保零源时 GET /search 返回 "results": [] 而非 null.
// 服务在零源时返回 nil 切片, 此处的 null 会让对该字段调用数组方法的客户端崩溃 (如 DetailPage 的恢复搜索).
func TestSearch_EmptyResultsIsArray(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "searcher", "pass", "user")
	bearer := loginAndGetBearer(t, r, "searcher", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=anything", nil)
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	results, ok := m["results"].([]any)
	if !ok {
		t.Fatalf("expected 'results' to be a JSON array (not null), got %T: %v", m["results"], m["results"])
	}
	if len(results) != 0 {
		t.Errorf("expected empty results with no sources configured, got %d", len(results))
	}
}

func TestSearch_BlankQueryAfterTrimIsRejected(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "blank-searcher", "pass", "user")
	bearer := loginAndGetBearer(t, r, "blank-searcher", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=+++%09+", nil)
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
	}
}

func TestSearch_ReranksExactTitleBeforeMergedUnrelatedSources(t *testing.T) {
	h, r, upstream := setupSearchTransportParityFixture(t)
	defer upstream.Close()

	disableAnonymousAccess(t, h)
	createTestUser(t, h, "search-parity", "pass", "user")
	bearer := loginAndGetBearer(t, r, "search-parity", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=Exact+Title", nil)
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	results, ok := m["results"].([]any)
	if !ok {
		t.Fatalf("expected 'results' to be a JSON array, got %T: %v", m["results"], m["results"])
	}
	assertSearchTransportParityResults(t, results)
}

func setupSearchTransportParityFixture(t *testing.T) (*Handler, *gin.Engine, *httptest.Server) {
	t.Helper()

	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/source/unrelated-a/api.php/provide/vod":
			writeSearchTransportParitySourceResult(t, w, upstream.URL, 101, "Popular Noise", "Noise desc from source A", "noise-a")
		case "/source/unrelated-b/api.php/provide/vod":
			writeSearchTransportParitySourceResult(t, w, upstream.URL, 102, "Popular Noise", "Noise desc from source B", "noise-b")
		case "/source/exact/api.php/provide/vod":
			writeSearchTransportParitySourceResult(t, w, upstream.URL, 201, "Exact Title", "Exact desc from source C", "exact")
		case "/live/noise-a.m3u8", "/live/noise-b.m3u8", "/live/exact.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = w.Write([]byte("#EXTM3U\n#EXTINF:10,\nseg.ts\n"))
		default:
			t.Fatalf("unexpected upstream request: %s", r.URL.String())
		}
	}))

	h, r := setupTestHandler(t)
	h.sourceClient = vodsource.NewClient(upstream.Client())
	h.proxySvc = service.NewProxyServiceWithClient(upstream.Client())
	h.searchSvc = service.NewSearchServiceWithClient(h.store, h.proxySvc, upstream.Client())

	createSearchTransportParitySource(t, h, "unrelated-a.example", "Unrelated A", upstream.URL+"/source/unrelated-a/api.php/provide/vod")
	createSearchTransportParitySource(t, h, "unrelated-b.example", "Unrelated B", upstream.URL+"/source/unrelated-b/api.php/provide/vod")
	createSearchTransportParitySource(t, h, "exact.example", "Exact", upstream.URL+"/source/exact/api.php/provide/vod")

	return h, r, upstream
}

func writeSearchTransportParitySourceResult(t *testing.T, w http.ResponseWriter, upstreamURL string, id int, title, desc, slug string) {
	t.Helper()
	_, _ = fmt.Fprintf(w, `{
		"code": 1,
		"list": [{
			"vod_id": %d,
			"vod_name": %q,
			"type_name": "movie",
			"vod_year": "2026",
			"vod_pic": "https://image.example/%s.jpg",
			"vod_blurb": %q,
			"vod_play_url": "HD$%s/live/%s.m3u8"
		}]
	}`, id, title, slug, desc, upstreamURL, slug)
}

func createSearchTransportParitySource(t *testing.T, h *Handler, key, name, api string) {
	t.Helper()
	id, err := h.store.CreateSource(&model.Source{
		Key:        key,
		Name:       name,
		API:        api,
		Enabled:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource %q error: %v", key, err)
	}
	if err := h.store.UpdateSourceHealth(id, consts.HealthHealthy); err != nil {
		t.Fatalf("UpdateSourceHealth %q error: %v", key, err)
	}
}

func assertSearchTransportParityResults(t *testing.T, results []any) {
	t.Helper()
	if len(results) != 2 {
		t.Fatalf("len(results) = %d, want 2 merged titles: %+v", len(results), results)
	}

	first, ok := results[0].(map[string]any)
	if !ok {
		t.Fatalf("results[0] = %T, want object: %+v", results[0], results[0])
	}
	if got := first["title"]; got != "Exact Title" {
		t.Fatalf("first title = %q, want Exact Title; results: %+v", got, results)
	}
	if got := first["type"]; got != "movie" {
		t.Fatalf("first type = %q, want movie", got)
	}
	if got := first["year"]; got != "2026" {
		t.Fatalf("first year = %q, want 2026", got)
	}
	if got, ok := first["cover"].(string); !ok || got == "" {
		t.Fatalf("first cover = %T %q, want non-empty string", first["cover"], got)
	}
	if got, ok := first["desc"].(string); !ok || got == "" {
		t.Fatalf("first desc = %T %q, want non-empty string", first["desc"], got)
	}
	sources, ok := first["sources"].([]any)
	if !ok || len(sources) != 1 {
		t.Fatalf("first sources = %T %+v, want one source array", first["sources"], first["sources"])
	}
	source, ok := sources[0].(map[string]any)
	if !ok {
		t.Fatalf("first source = %T, want object: %+v", sources[0], sources[0])
	}
	if source["source_key"] != "exact.example" || source["video_id"] != "201" {
		t.Fatalf("first source schema/key = %+v, want exact.example video 201", source)
	}
	episodes, ok := source["episodes"].([]any)
	if !ok || len(episodes) != 1 {
		t.Fatalf("first source episodes = %T %+v, want one episode", source["episodes"], source["episodes"])
	}

	second, ok := results[1].(map[string]any)
	if !ok {
		t.Fatalf("results[1] = %T, want object: %+v", results[1], results[1])
	}
	if got := second["title"]; got != "Popular Noise" {
		t.Fatalf("second title = %q, want Popular Noise", got)
	}
	secondSources, ok := second["sources"].([]any)
	if !ok || len(secondSources) != 2 {
		t.Fatalf("second sources = %T %+v, want two merged sources", second["sources"], second["sources"])
	}
}
