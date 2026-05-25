package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/service"
)

func TestListSources(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin1", "pw", "admin")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/sources", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin1"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	if _, ok := m["sources"]; !ok {
		t.Error("expected 'sources' key in response")
	}
}

func TestCreateSource(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin2", "pw", "admin")

	body, _ := json.Marshal(map[string]any{
		"key":     "test.com",
		"name":    "Test Source",
		"api":     "https://test.com/api.php",
		"detail":  "https://test.com",
		"enabled": true,
		"comment": "test",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sources", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin2"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateAndDeleteSource(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_source_update", "pw", "admin")
	id, err := h.store.CreateSource(&model.Source{
		Key:     "source-update.example",
		Name:    "Before",
		API:     "https://before.example/api.php",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	body, _ := json.Marshal(map[string]any{
		"name":    "After",
		"api":     "https://after.example/api.php",
		"detail":  "https://after.example",
		"enabled": false,
		"comment": "updated",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/sources/"+strconv.FormatInt(id, 10), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_source_update"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got, err := h.store.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID error: %v", err)
	}
	if got.Name != "After" || got.API != "https://after.example/api.php" || got.Enabled {
		t.Fatalf("source was not updated: %+v", got)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/sources/"+strconv.FormatInt(id, 10), nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin_source_update"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got, err = h.store.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID after delete error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected deleted source to be nil, got %+v", got)
	}
}

func TestBulkSetSourcesEnabled(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_bulk", "pw", "admin")

	const n = 5
	ids := make([]int64, n)
	for i := 0; i < n; i++ {
		id, err := h.store.CreateSource(&model.Source{
			Key:     "bulk-handler-" + strconv.Itoa(i),
			Name:    "Bulk " + strconv.Itoa(i),
			API:     "https://bulk-" + strconv.Itoa(i) + ".example/api.php",
			Enabled: false,
		})
		if err != nil {
			t.Fatalf("CreateSource %d: %v", i, err)
		}
		ids[i] = id
	}

	body, _ := json.Marshal(map[string]any{"ids": ids, "enabled": true})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sources/bulk-enabled", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_bulk"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	for _, id := range ids {
		got, err := h.store.GetSourceByID(id)
		if err != nil {
			t.Fatalf("GetSourceByID %d: %v", id, err)
		}
		if !got.Enabled {
			t.Errorf("source %d expected enabled=true after bulk", id)
		}
	}

	// Empty ids returns 400.
	// 空 ids 返回 400.
	body, _ = json.Marshal(map[string]any{"ids": []int64{}, "enabled": true})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/sources/bulk-enabled", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_bulk"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty ids, got %d: %s", rec.Code, rec.Body.String())
	}

	// Unknown id rolls back, prior state preserved, 404 returned.
	// 未知 id 触发整批回滚, 之前的状态保留, 返回 404.
	body, _ = json.Marshal(map[string]any{"ids": []int64{ids[0], 99999}, "enabled": false})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/sources/bulk-enabled", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_bulk"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown id, got %d: %s", rec.Code, rec.Body.String())
	}
	got, err := h.store.GetSourceByID(ids[0])
	if err != nil {
		t.Fatalf("GetSourceByID after rollback: %v", err)
	}
	if !got.Enabled {
		t.Error("first source should remain enabled after rollback")
	}
}

func TestImportSources(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_import", "pw", "admin")

	body := `{
		"cache_time": 3600,
		"api_site": {
			"import-a.example": {
				"name": "Import A",
				"api": "https://import-a.example/api.php",
				"detail": "https://import-a.example",
				"_comment": "a"
			}
		}
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sources/import", strings.NewReader(body))
	req.Header.Set("Authorization", adminBearer(t, h, "admin_import"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got, err := h.store.GetSourceByKey("import-a.example")
	if err != nil {
		t.Fatalf("GetSourceByKey error: %v", err)
	}
	if got == nil || got.Name != "Import A" {
		t.Fatalf("source was not imported: %+v", got)
	}
}

func TestSubscriptionsCRUD(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_subs", "pw", "admin")

	body, _ := json.Marshal(map[string]any{
		"url":         "https://subscription.example/config.json",
		"auto_update": true,
		"interval":    3600,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/subscriptions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_subs"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	id := int64(m["id"].(float64))

	req = httptest.NewRequest(http.MethodGet, "/api/v1/admin/subscriptions", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin_subs"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body, _ = json.Marshal(map[string]any{
		"url":         "https://subscription.example/updated.json",
		"auto_update": false,
		"interval":    7200,
	})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/admin/subscriptions/"+strconv.FormatInt(id, 10), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_subs"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/subscriptions/"+strconv.FormatInt(id, 10), nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin_subs"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminCheckSourceAndSyncSubscription(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api.php":
			w.WriteHeader(http.StatusOK)
		case "/config.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"cache_time": 3600,
				"api_site": {
					"sync.example": {
						"name": "Sync Source",
						"api": "https://sync.example/api.php",
						"detail": "https://sync.example"
					}
				}
			}`))
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	h, r := setupTestHandler(t)
	h.sourceSvc = service.NewSourceServiceWithClient(h.store, upstream.Client())
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_source_actions", "pw", "admin")

	sourceID, err := h.store.CreateSource(&model.Source{
		Key:     "check.example",
		Name:    "Check Source",
		API:     upstream.URL + "/api.php",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	subID, err := h.store.CreateSubscription(upstream.URL+"/config.json", false, 3600)
	if err != nil {
		t.Fatalf("CreateSubscription error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sources/"+strconv.FormatInt(sourceID, 10)+"/check", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin_source_actions"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/subscriptions/"+strconv.FormatInt(subID, 10)+"/sync", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin_source_actions"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	src, err := h.store.GetSourceByKey("sync.example")
	if err != nil {
		t.Fatalf("GetSourceByKey error: %v", err)
	}
	if src == nil || src.Name != "Sync Source" {
		t.Fatalf("subscription sync did not import source: %+v", src)
	}
}

func TestCheckAllSources(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_check_all", "pw", "admin")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sources/check-all", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin_check_all"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminSourceErrorPaths(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_source_errors", "pw", "admin")

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		status int
	}{
		{name: "create missing fields", method: http.MethodPost, path: "/api/v1/admin/sources", body: `{}`, status: http.StatusBadRequest},
		{name: "create invalid URL", method: http.MethodPost, path: "/api/v1/admin/sources", body: `{"key":"bad","name":"Bad","api":"ftp://bad.example/api"}`, status: http.StatusBadRequest},
		{name: "update invalid id", method: http.MethodPut, path: "/api/v1/admin/sources/not-id", body: `{}`, status: http.StatusBadRequest},
		{name: "update missing source", method: http.MethodPut, path: "/api/v1/admin/sources/9999", body: `{"name":"Missing","api":"https://missing.example/api"}`, status: http.StatusNotFound},
		{name: "update invalid URL", method: http.MethodPut, path: "/api/v1/admin/sources/9999", body: `{"name":"Bad","api":"ftp://bad.example/api"}`, status: http.StatusBadRequest},
		{name: "delete invalid id", method: http.MethodDelete, path: "/api/v1/admin/sources/not-id", status: http.StatusBadRequest},
		{name: "delete missing source", method: http.MethodDelete, path: "/api/v1/admin/sources/9999", status: http.StatusNotFound},
		{name: "check invalid id", method: http.MethodPost, path: "/api/v1/admin/sources/not-id/check", status: http.StatusBadRequest},
		{name: "check missing source", method: http.MethodPost, path: "/api/v1/admin/sources/9999/check", status: http.StatusInternalServerError},
		{name: "import invalid config", method: http.MethodPost, path: "/api/v1/admin/sources/import", body: `{"api_site":`, status: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", adminBearer(t, h, "admin_source_errors"))
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.status, rec.Body.String())
			}
		})
	}
}

func TestAdminSubscriptionErrorPaths(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_sub_errors", "pw", "admin")

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		status int
	}{
		{name: "create missing URL", method: http.MethodPost, path: "/api/v1/admin/subscriptions", body: `{}`, status: http.StatusBadRequest},
		{name: "create invalid URL", method: http.MethodPost, path: "/api/v1/admin/subscriptions", body: `{"url":"file:///tmp/config.json"}`, status: http.StatusBadRequest},
		{name: "update invalid id", method: http.MethodPut, path: "/api/v1/admin/subscriptions/not-id", body: `{}`, status: http.StatusBadRequest},
		{name: "update missing", method: http.MethodPut, path: "/api/v1/admin/subscriptions/9999", body: `{"url":"https://missing.example/config.json"}`, status: http.StatusNotFound},
		{name: "update invalid URL", method: http.MethodPut, path: "/api/v1/admin/subscriptions/9999", body: `{"url":"ftp://bad.example/config.json"}`, status: http.StatusBadRequest},
		{name: "delete invalid id", method: http.MethodDelete, path: "/api/v1/admin/subscriptions/not-id", status: http.StatusBadRequest},
		{name: "delete missing", method: http.MethodDelete, path: "/api/v1/admin/subscriptions/9999", status: http.StatusNotFound},
		{name: "sync invalid id", method: http.MethodPost, path: "/api/v1/admin/subscriptions/not-id/sync", status: http.StatusBadRequest},
		{name: "sync missing", method: http.MethodPost, path: "/api/v1/admin/subscriptions/9999/sync", status: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", adminBearer(t, h, "admin_sub_errors"))
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.status, rec.Body.String())
			}
		})
	}
}
