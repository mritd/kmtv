package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func performSyncRequest(t *testing.T, r http.Handler, method, path, bearer string, body any) *httptest.ResponseRecorder {
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

type syncPushReply struct {
	Epoch        string `json:"epoch"`
	Rev          int64  `json:"rev"`
	ServerTimeMS int64  `json:"server_time_ms"`
	Results      []struct {
		Index  int    `json:"index"`
		Status string `json:"status"`
		Reason string `json:"reason"`
		Record *struct {
			Key string `json:"key"`
		} `json:"record"`
	} `json:"results"`
}

type syncPullReply struct {
	Epoch        string `json:"epoch"`
	ServerTimeMS int64  `json:"server_time_ms"`
	Rev          int64  `json:"rev"`
	Reset        bool   `json:"reset"`
	HasMore      bool   `json:"has_more"`
	Records      []struct {
		Kind string `json:"kind"`
		Key  string `json:"key"`
	} `json:"records"`
	Clears []json.RawMessage `json:"clears"`
}

func decodeSync[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return out
}

func TestSyncHandlersRejectAnonymous(t *testing.T) {
	// anonymous_access defaults to "true", so these requests pass Auth with no user.
	//
	// anonymous_access 默认为 "true", 这些请求会以无用户状态通过 Auth.
	_, r := setupTestHandler(t)
	if rec := performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", "", map[string]any{"changes": []any{}}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("push without login: %d %s", rec.Code, rec.Body.String())
	}
	if rec := performSyncRequest(t, r, http.MethodGet, "/api/v1/sync/pull", "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("pull without login: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSyncPushAndPull(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "sync_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "sync_api", "pass")

	rec := performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", bearer, map[string]any{
		"epoch": "",
		"changes": []map[string]any{
			{"kind": "watch", "op": "upsert", "event_time_ms": 1000, "payload": map[string]any{"title": "Demo Show", "progress_sec": 12}},
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("push: %d %s", rec.Code, rec.Body.String())
	}
	push := decodeSync[syncPushReply](t, rec)
	if push.Epoch == "" || push.Rev != 1 || push.ServerTimeMS <= 0 || len(push.Results) != 1 ||
		push.Results[0].Status != "applied" || push.Results[0].Record == nil || push.Results[0].Record.Key != "demo show" {
		t.Fatalf("push reply: %+v", push)
	}

	rec = performSyncRequest(t, r, http.MethodGet, "/api/v1/sync/pull?since=0&epoch="+push.Epoch, bearer, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("pull: %d %s", rec.Code, rec.Body.String())
	}
	pull := decodeSync[syncPullReply](t, rec)
	if pull.Epoch != push.Epoch || pull.Reset || pull.Rev != 1 || len(pull.Records) != 1 || pull.Records[0].Key != "demo show" || pull.Clears == nil {
		t.Fatalf("pull reply: %+v", pull)
	}
}

func TestSyncPushReportsInvalidChange(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "sync_invalid_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "sync_invalid_api", "pass")
	rec := performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", bearer, map[string]any{
		"changes": []map[string]any{
			{"kind": "watch", "op": "upsert", "event_time_ms": 1000, "payload": map[string]any{"title": ""}},
			{"kind": "search", "op": "upsert", "event_time_ms": 1001, "payload": map[string]any{"query": "ok"}},
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("push: %d %s", rec.Code, rec.Body.String())
	}
	push := decodeSync[syncPushReply](t, rec)
	if push.Results[0].Status != "invalid" || push.Results[0].Reason == "" || push.Results[1].Status != "applied" {
		t.Fatalf("results: %+v", push.Results)
	}
}

func TestSyncPushRejectsEpochMismatch(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "sync_epoch_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "sync_epoch_api", "pass")
	epoch, err := h.store.SyncEpoch()
	if err != nil {
		t.Fatalf("SyncEpoch: %v", err)
	}

	rec := performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", bearer, map[string]any{
		"epoch":   "old-epoch",
		"changes": []map[string]any{{"kind": "search", "op": "upsert", "event_time_ms": 1, "payload": map[string]any{"query": "x"}}},
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d %s", rec.Code, rec.Body.String())
	}
	body := decodeSync[struct {
		Code  int    `json:"code"`
		Epoch string `json:"epoch"`
	}](t, rec)
	if body.Code != 1209 || body.Epoch != epoch {
		t.Fatalf("mismatch body: %+v", body)
	}

	rec = performSyncRequest(t, r, http.MethodGet, "/api/v1/sync/pull?since=7&epoch=old-epoch", bearer, nil)
	pull := decodeSync[syncPullReply](t, rec)
	if rec.Code != http.StatusOK || !pull.Reset || pull.Epoch != epoch || pull.Rev != 0 {
		t.Fatalf("pull with an old epoch must reset with the current rev (0, nothing written): %d %+v", rec.Code, pull)
	}
}

func TestSyncPushRejectsCursorAhead(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "sync_cursor_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "sync_cursor_api", "pass")
	epoch, err := h.store.SyncEpoch()
	if err != nil {
		t.Fatalf("SyncEpoch: %v", err)
	}
	change := map[string]any{"kind": "search", "op": "upsert", "event_time_ms": 1, "payload": map[string]any{"query": "x"}}

	rec := performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", bearer, map[string]any{
		"epoch": epoch, "cursor": 5, "changes": []map[string]any{change},
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d %s", rec.Code, rec.Body.String())
	}
	body := decodeSync[struct {
		Code  int    `json:"code"`
		Epoch string `json:"epoch"`
	}](t, rec)
	if body.Code != 1210 || body.Epoch != epoch {
		t.Fatalf("cursor-ahead body: %+v", body)
	}
	pull := decodeSync[syncPullReply](t, performSyncRequest(t, r, http.MethodGet, "/api/v1/sync/pull?since=0", bearer, nil))
	if len(pull.Records) != 0 {
		t.Fatalf("a rejected push must not write: %+v", pull)
	}

	rec = performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", bearer, map[string]any{
		"epoch": epoch, "cursor": 0, "changes": []map[string]any{change},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("a cursor at or below the rev must be accepted: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSyncPushReportsMalformedChangeInPlace(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "sync_malformed_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "sync_malformed_api", "pass")

	rec := performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", bearer, map[string]any{
		"changes": []map[string]any{
			{"kind": "search", "op": "upsert", "event_time_ms": 1.5, "payload": map[string]any{"query": "bad"}},
			{"kind": "search", "op": "upsert", "event_time_ms": 2, "payload": map[string]any{"query": "good"}},
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", rec.Code, rec.Body.String())
	}
	push := decodeSync[syncPushReply](t, rec)
	if len(push.Results) != 2 || push.Results[0].Index != 0 || push.Results[0].Status != "invalid" ||
		push.Results[1].Index != 1 || push.Results[1].Status != "applied" {
		t.Fatalf("results: %+v", push.Results)
	}
}

func TestSyncPushLimits(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "sync_limits_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "sync_limits_api", "pass")

	changes := make([]map[string]any, maxSyncPushChanges+1)
	for i := range changes {
		changes[i] = map[string]any{"kind": "search", "op": "upsert", "event_time_ms": i + 1, "payload": map[string]any{"query": fmt.Sprintf("q%d", i)}}
	}
	if rec := performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", bearer, map[string]any{"changes": changes}); rec.Code != http.StatusBadRequest {
		t.Fatalf("too many changes: %d %s", rec.Code, rec.Body.String())
	}
	big := map[string]any{"changes": []map[string]any{{
		"kind": "favorite", "op": "upsert", "event_time_ms": 1,
		"payload": map[string]any{"title": "A", "desc": strings.Repeat("x", maxSyncPushBodyBytes)},
	}}}
	if rec := performSyncRequest(t, r, http.MethodPost, "/api/v1/sync/push", bearer, big); rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized body: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSyncPullValidatesQuery(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "sync_query_api", "pass", "user")
	bearer := loginAndGetBearer(t, r, "sync_query_api", "pass")
	for _, path := range []string{"/api/v1/sync/pull?since=-1", "/api/v1/sync/pull?since=x", "/api/v1/sync/pull?limit=0"} {
		if rec := performSyncRequest(t, r, http.MethodGet, path, bearer, nil); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d", path, rec.Code)
		}
	}
	if rec := performSyncRequest(t, r, http.MethodGet, "/api/v1/sync/pull?limit=5000", bearer, nil); rec.Code != http.StatusOK {
		t.Fatalf("large limit must be clamped, got %d", rec.Code)
	}
}
