package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestSearch_EmptyResultsIsArray guards that GET /search returns "results": [] (never null)
// when no sources are configured. The service returns a nil slice for zero sources, and a
// null here crashes clients that call array methods on the field (e.g. DetailPage's recovery search).
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
