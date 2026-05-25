package handler

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/vodsource"
)

func TestSearchStream_MissingQuery(t *testing.T) {
	_, r := setupTestHandler(t)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/search/stream", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestSearchStream_SSEHeaders(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "streamer", "pass", "user")
	bearer := loginAndGetBearer(t, r, "streamer", "pass")

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/search/stream?q=test", nil)
	req.Header.Set("Authorization", bearer)
	r.ServeHTTP(w, req)

	ct := w.Header().Get("Content-Type")
	if !strings.Contains(ct, "text/event-stream") {
		t.Errorf("expected Content-Type text/event-stream, got %q", ct)
	}
}

func TestSearchStream_EmptyResults(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "streamer2", "pass", "user")
	bearer := loginAndGetBearer(t, r, "streamer2", "pass")

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/search/stream?q=nonexistent", nil)
	req.Header.Set("Authorization", bearer)
	r.ServeHTTP(w, req)

	body := w.Body.String()
	scanner := bufio.NewScanner(strings.NewReader(body))
	hasResult := false
	for scanner.Scan() {
		line := scanner.Text()
		if line == "event: result" {
			hasResult = true
		}
	}
	if !hasResult {
		t.Error("expected at least one 'event: result' in SSE stream")
	}
}

func TestSearchStream_WithProgressAndResult(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Query().Get("ac") == "videolist":
			_, _ = w.Write([]byte(`{
				"code": 1,
				"list": [{
					"vod_id": 301,
					"vod_name": "Stream Movie",
					"type_name": "movie",
					"vod_year": "2026",
					"vod_blurb": "Stream desc",
					"vod_play_url": "HD$` + upstream.URL + `/live/stream.m3u8"
				}]
			}`))
		case r.URL.Path == "/live/stream.m3u8":
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = w.Write([]byte("#EXTM3U\n#EXTINF:10,\nseg.ts\n"))
		default:
			t.Fatalf("unexpected upstream request: %s", r.URL.String())
		}
	}))
	defer upstream.Close()

	h, r := setupTestHandler(t)
	h.sourceClient = vodsource.NewClient(upstream.Client())
	h.proxySvc = service.NewProxyServiceWithClient(upstream.Client())
	h.searchSvc = service.NewSearchServiceWithClient(h.store, h.proxySvc, upstream.Client())
	id, err := h.store.CreateSource(&model.Source{
		Key:        "stream-source.example",
		Name:       "Stream Source",
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

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/search/stream?q=stream", nil)
	r.ServeHTTP(w, req)

	body := w.Body.String()
	if !strings.Contains(body, "event: progress") {
		t.Fatalf("expected progress event, got %s", body)
	}
	if !strings.Contains(body, "event: result") || !strings.Contains(body, "Stream Movie") {
		t.Fatalf("expected result event with movie, got %s", body)
	}
}
