package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestWatchHistoryHandlersRequireRealUser(t *testing.T) {
	_, r := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/history", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for anonymous history list, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWatchHistoryHandlersCRUD(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "history_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "history_api", "pass")

	body := map[string]any{
		"title":         "Demo Show",
		"source_key":    "source-a",
		"video_id":      "1",
		"cover":         "https://example.test/poster.jpg",
		"episode":       "E1",
		"group_index":   0,
		"episode_index": 1,
		"progress_sec":  80,
		"duration_sec":  1000,
		"event_time_ms": 1000,
	}
	rec := performHistoryRequest(t, r, http.MethodPut, "/api/v1/history", bearer, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected upsert 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var item map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &item); err != nil {
		t.Fatalf("decode upsert response: %v", err)
	}
	if item["title"] != "Demo Show" || item["source_key"] != "source-a" {
		t.Fatalf("unexpected upsert response: %+v", item)
	}

	body["title"] = " demo show "
	body["source_key"] = "source-b"
	body["video_id"] = "2"
	body["episode"] = "E2"
	body["progress_sec"] = 970
	body["completed"] = true
	body["event_time_ms"] = 2000
	rec = performHistoryRequest(t, r, http.MethodPut, "/api/v1/history", bearer, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected second upsert 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &item); err != nil {
		t.Fatalf("decode second upsert response: %v", err)
	}
	if item["source_key"] != "source-b" || item["completed"] != true {
		t.Fatalf("expected title-deduped completed row, got %+v", item)
	}
	body["event_time_ms"] = 1500
	rec = performHistoryRequest(t, r, http.MethodPut, "/api/v1/history", bearer, body)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected stale upsert 409, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = performHistoryRequest(t, r, http.MethodGet, "/api/v1/history?limit=10", bearer, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected list 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var listResp struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(listResp.Items) != 1 {
		t.Fatalf("expected one deduped history item, got %+v", listResp.Items)
	}

	itemURL := "/api/v1/history/item?title=" + url.QueryEscape("DEMO SHOW")
	rec = performHistoryRequest(t, r, http.MethodGet, itemURL, bearer, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected get item 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = performHistoryRequest(t, r, http.MethodDelete, itemURL, bearer, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected delete item 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = performHistoryRequest(t, r, http.MethodGet, itemURL, bearer, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected get item 404 after delete, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWatchHistoryHandlerRejectsOversizedBody(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "history_size_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "history_size_api", "pass")
	rec := performHistoryRequest(t, r, http.MethodPut, "/api/v1/history", bearer, map[string]any{
		"title":         strings.Repeat("x", maxWatchHistoryBodyBytes),
		"event_time_ms": 1,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected oversized history body 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestWatchHistoryClearHandler(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "history_clear_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "history_clear_api", "pass")

	for i, title := range []string{"A", "B"} {
		rec := performHistoryRequest(t, r, http.MethodPut, "/api/v1/history", bearer, map[string]any{"title": title, "event_time_ms": i + 1})
		if rec.Code != http.StatusOK {
			t.Fatalf("upsert %s failed: %d %s", title, rec.Code, rec.Body.String())
		}
	}
	rec := performHistoryRequest(t, r, http.MethodDelete, "/api/v1/history?event_time_ms=3", bearer, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected clear 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = performHistoryRequest(t, r, http.MethodGet, "/api/v1/history", bearer, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected list 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var listResp struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(listResp.Items) != 0 {
		t.Fatalf("expected empty history after clear, got %+v", listResp.Items)
	}
}

func performHistoryRequest(t *testing.T, r http.Handler, method, path, bearer string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", bearer)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}
