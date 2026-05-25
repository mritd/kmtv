package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/store"
)

func TestListUsers(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin3", "pw", "admin")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin3"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	users, ok := m["users"]
	if !ok {
		t.Fatal("expected 'users' key in response")
	}
	arr, ok := users.([]any)
	if !ok {
		t.Fatal("expected users to be an array")
	}
	if len(arr) == 0 {
		t.Error("expected at least one user")
	}
}

func TestCreateUser_ValidRole(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin4", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		"username": "newuser",
		"password": "newpass",
		"role":     "user",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin4"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	if m["username"] != "newuser" {
		t.Errorf("expected username newuser, got %v", m["username"])
	}
	if m["role"] != "user" {
		t.Errorf("expected role user, got %v", m["role"])
	}
}

func TestCreateUser_InvalidRole(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin5", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		"username": "baduser",
		"password": "pw",
		"role":     "superadmin",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin5"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCreateUser_EmptyUsername(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_eu", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		"username": "   ",
		"password": "validpass",
		"role":     "user",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_eu"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	errMsg, ok := m["error"].(string)
	if !ok || errMsg != "username and password must not be empty" {
		t.Errorf("expected missing fields error, got %v", m["error"])
	}
}

func TestCreateUser_EmptyPassword(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_ep", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		"username": "validuser",
		"password": "  ",
		"role":     "user",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_ep"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	errMsg, ok := m["error"].(string)
	if !ok || errMsg != "username and password must not be empty" {
		t.Errorf("expected missing fields error, got %v", m["error"])
	}
}

func TestCreateUser_ValidData(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_vd", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		"username": "gooduser",
		"password": "goodpass",
		"role":     "user",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_vd"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	if m["username"] != "gooduser" {
		t.Errorf("expected username gooduser, got %v", m["username"])
	}
	if m["role"] != "user" {
		t.Errorf("expected role user, got %v", m["role"])
	}
	if m["id"] == nil {
		t.Error("expected id in response")
	}
}

func TestUpdateAndDeleteUser(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_user_update", "pw", "admin")
	targetID := createTestUser(t, h, "target_user", "oldpass", "user")

	body, _ := json.Marshal(map[string]string{
		"username": "target_renamed",
		"password": "newpass",
		"role":     "admin",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/"+strconv.FormatInt(targetID, 10), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_user_update"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got, err := h.store.GetUserByID(targetID)
	if err != nil {
		t.Fatalf("GetUserByID error: %v", err)
	}
	if got.Username != "target_renamed" || got.Role != "admin" || !store.CheckPassword(got.Password, "newpass") {
		t.Fatalf("user was not updated: %+v", got)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/"+strconv.FormatInt(targetID, 10), nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin_user_update"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got, err = h.store.GetUserByID(targetID)
	if err != nil {
		t.Fatalf("GetUserByID after delete error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected deleted user to be nil, got %+v", got)
	}
}

func TestDeleteUserRejectsSelfAndMissingTarget(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	adminID := createTestUser(t, h, "admin_self_delete", "pw", "admin")
	bearer := adminBearer(t, h, "admin_self_delete")

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/"+strconv.FormatInt(adminID, 10), nil)
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 self delete, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/999999", nil)
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 missing user, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateUserPasswordRevokesAccessTokens(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_update_revoke", "pw", "admin")
	targetID := createTestUser(t, h, "target_update_revoke", "oldpass", "user")
	targetBearer := loginAndGetBearer(t, r, "target_update_revoke", "oldpass")

	body, _ := json.Marshal(map[string]string{
		"username": "target_update_revoke",
		"password": "newpass",
		"role":     "user",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/"+strconv.FormatInt(targetID, 10), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_update_revoke"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update user expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", targetBearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked user token expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateUserRoleInvalidatesCachedBearerUser(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_role_revoke", "pw", "admin")
	targetID := createTestUser(t, h, "target_role_cache", "pass", "admin")
	targetBearer := loginAndGetBearer(t, r, "target_role_cache", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
	req.Header.Set("Authorization", targetBearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("target admin expected 200 before role change, got %d: %s", rec.Code, rec.Body.String())
	}

	body, _ := json.Marshal(map[string]string{
		"username": "target_role_cache",
		"role":     "user",
	})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/"+strconv.FormatInt(targetID, 10), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_role_revoke"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update user expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
	req.Header.Set("Authorization", targetBearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("target token should use refreshed non-admin role, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteUserRevokesAccessTokens(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_delete_revoke", "pw", "admin")
	targetID := createTestUser(t, h, "victim_revoke", "pw", "user")
	victimBearer := loginAndGetBearer(t, r, "victim_revoke", "pw")

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/"+strconv.FormatInt(targetID, 10), nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin_delete_revoke"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete user expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", victimBearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked user token expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminUserSafetyGuards(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	adminID := createTestUser(t, h, "only_admin", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		"username": "only_admin",
		"role":     "user",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/users/"+strconv.FormatInt(adminID, 10), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "only_admin"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 demoting last admin, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/"+strconv.FormatInt(adminID, 10), nil)
	req.Header.Set("Authorization", adminBearer(t, h, "only_admin"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 self delete, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/9999", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "only_admin"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 missing user, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminUserErrorPaths(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_user_errors", "pw", "admin")

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		status int
	}{
		{name: "create bad body", method: http.MethodPost, path: "/api/v1/admin/users", body: `{`, status: http.StatusBadRequest},
		{name: "update invalid id", method: http.MethodPut, path: "/api/v1/admin/users/not-id", body: `{}`, status: http.StatusBadRequest},
		{name: "update invalid role", method: http.MethodPut, path: "/api/v1/admin/users/9999", body: `{"username":"bad","role":"owner"}`, status: http.StatusBadRequest},
		{name: "update missing", method: http.MethodPut, path: "/api/v1/admin/users/9999", body: `{"username":"missing","role":"user"}`, status: http.StatusNotFound},
		{name: "delete invalid id", method: http.MethodDelete, path: "/api/v1/admin/users/not-id", status: http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", adminBearer(t, h, "admin_user_errors"))
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.status, rec.Body.String())
			}
		})
	}
}

func TestProfileAndAvatarErrorPaths(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "profile_errors", "oldpass", "user")
	bearer := loginAndGetBearer(t, r, "profile_errors", "oldpass")

	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/password", strings.NewReader(`{"old_password":"wrong","new_password":"new"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 wrong old password, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/avatar", nil)
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for wrong avatar method route, got %d", rec.Code)
	}

	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile("avatar", "avatar.txt")
	if err != nil {
		t.Fatalf("CreateFormFile error: %v", err)
	}
	_, _ = part.Write([]byte("not an image"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/avatar", &upload)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 unsupported image, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/avatar/profile_errors", nil)
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 no avatar, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProfileConflictAndInvalidSession(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "profile_conflict_a", "pass", "user")
	createTestUser(t, h, "profile_conflict_b", "pass", "user")
	bearer := loginAndGetBearer(t, r, "profile_conflict_a", "pass")

	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/profile", strings.NewReader(`{"username":"profile_conflict_b"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 username conflict, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/profile", strings.NewReader(`{"username":"new_name"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer bad-session")
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 invalid session, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAvatarInvalidStoredData(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	id := createTestUser(t, h, "avatar_invalid", "pass", "user")
	bearer := loginAndGetBearer(t, r, "avatar_invalid", "pass")

	if err := h.store.UpdateAvatar(id, "not-a-data-url"); err != nil {
		t.Fatalf("UpdateAvatar error: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/avatar/avatar_invalid", nil)
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 invalid avatar data, got %d: %s", rec.Code, rec.Body.String())
	}

	if err := h.store.UpdateAvatar(id, "data:image/png;base64,%%%"); err != nil {
		t.Fatalf("UpdateAvatar invalid base64 error: %v", err)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/avatar/avatar_invalid", nil)
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 invalid base64, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestProfilePasswordAndAvatar(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "profile_user", "oldpass", "user")
	bearer := loginAndGetBearer(t, r, "profile_user", "oldpass")

	body, _ := json.Marshal(map[string]string{"username": "profile_renamed"})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/profile", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body, _ = json.Marshal(map[string]string{"old_password": "oldpass", "new_password": "newpass"})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	bearer = loginAndGetBearer(t, r, "profile_renamed", "newpass")

	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile("avatar", "avatar.png")
	if err != nil {
		t.Fatalf("CreateFormFile error: %v", err)
	}
	_, _ = part.Write([]byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01,
	})
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/avatar", &upload)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/avatar/profile_renamed", nil)
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content type = %q, want image/png", rec.Header().Get("Content-Type"))
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/auth/avatar", nil)
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadAvatarRejectsInvalidFiles(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "avatar_reject", "pass", "user")
	bearer := loginAndGetBearer(t, r, "avatar_reject", "pass")

	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/avatar", nil)
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 missing avatar, got %d: %s", rec.Code, rec.Body.String())
	}

	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile("avatar", "note.txt")
	if err != nil {
		t.Fatalf("CreateFormFile text: %v", err)
	}
	_, _ = part.Write([]byte("not an image"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close text multipart: %v", err)
	}
	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/avatar", &upload)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 unsupported avatar type, got %d: %s", rec.Code, rec.Body.String())
	}

	upload.Reset()
	writer = multipart.NewWriter(&upload)
	part, err = writer.CreateFormFile("avatar", "large.png")
	if err != nil {
		t.Fatalf("CreateFormFile large: %v", err)
	}
	_, _ = part.Write(make([]byte, 256*1024+1))
	if err := writer.Close(); err != nil {
		t.Fatalf("close large multipart: %v", err)
	}
	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/avatar", &upload)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 avatar too large, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetSettings_Admin(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin6", "pw", "admin")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "admin6"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	settingsMap, ok := m["settings"].(map[string]any)
	if !ok {
		t.Fatal("expected settings to be a map")
	}
	if _, ok := settingsMap["site_name"]; !ok {
		t.Error("admin should see 'site_name' in settings")
	}
	if _, ok := settingsMap["version"]; !ok {
		t.Error("admin should see 'version' in settings")
	}
}

func TestGetSettings_Anonymous(t *testing.T) {
	_, r := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	settingsMap, ok := m["settings"].(map[string]any)
	if !ok {
		t.Fatal("expected settings to be a map")
	}
	if _, ok := settingsMap["version"]; !ok {
		t.Error("anonymous should see 'version' in settings")
	}
	if _, ok := settingsMap["site_name"]; ok {
		t.Error("anonymous should NOT see 'site_name' in settings")
	}
}

func TestUpdateSettings(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin7", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		"site_name": "MyKMTV",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin7"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify the setting was persisted.
	val, err := h.store.GetSetting("site_name")
	if err != nil {
		t.Fatalf("get setting: %v", err)
	}
	if val != "MyKMTV" {
		t.Errorf("expected site_name=MyKMTV, got %q", val)
	}
}

func TestUpdateSettings_PublicBaseURLValidation(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "admin_public_url", "pw", "admin")

	body, _ := json.Marshal(map[string]string{
		consts.SettingPublicBaseURL: "https://kmtv.example/base",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_public_url"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	val, err := h.store.GetSetting(consts.SettingPublicBaseURL)
	if err != nil {
		t.Fatalf("get public_base_url: %v", err)
	}
	if val != "https://kmtv.example/base" {
		t.Fatalf("public_base_url = %q", val)
	}

	body, _ = json.Marshal(map[string]string{
		consts.SettingPublicBaseURL: "javascript:alert(1)",
	})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", adminBearer(t, h, "admin_public_url"))
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid public_base_url, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------- Search handler tests ----------
