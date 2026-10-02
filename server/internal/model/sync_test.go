package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeSyncKeyMatchesSharedVectors(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "sync-key-vectors.json"))
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var file struct {
		Vectors []struct {
			Input string `json:"input"`
			Key   string `json:"key"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("decode vectors: %v", err)
	}
	if len(file.Vectors) < 10 {
		t.Fatalf("expected at least 10 vectors, got %d", len(file.Vectors))
	}
	for _, v := range file.Vectors {
		if got := NormalizeSyncKey(v.Input); got != v.Key {
			t.Errorf("NormalizeSyncKey(%q) = %q, want %q", v.Input, got, v.Key)
		}
	}
}

func TestNormalizeSyncPayloadWatch(t *testing.T) {
	key, payload, err := NormalizeSyncPayload(SyncKindWatch, json.RawMessage(
		`{"title":"  Demo  Show ","cover":"c","source_key":" s1 ","video_id":"v1","episode":"E2",`+
			`"group_index":0,"episode_index":1,"progress_sec":12.5,"duration_sec":1800,"completed":false,"extra":"x"}`,
	))
	if err != nil {
		t.Fatalf("NormalizeSyncPayload: %v", err)
	}
	if key != "demo show" {
		t.Fatalf("key = %q, want %q", key, "demo show")
	}
	var p WatchPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		t.Fatalf("decode canonical payload: %v", err)
	}
	if p.Title != "Demo  Show" || p.SourceKey != "s1" || p.EpisodeIndex != 1 || p.ProgressSec != 12.5 {
		t.Fatalf("unexpected canonical payload: %+v", p)
	}
	if strings.Contains(string(payload), "extra") {
		t.Fatalf("unknown fields must be dropped, got %s", payload)
	}
}

func TestNormalizeSyncPayloadFavoriteAndSearch(t *testing.T) {
	key, _, err := NormalizeSyncPayload(SyncKindFavorite, json.RawMessage(`{"title":"Show X","year":"2020","rate":"8.1"}`))
	if err != nil || key != "show x" {
		t.Fatalf("favorite key = %q, err = %v", key, err)
	}
	key, payload, err := NormalizeSyncPayload(SyncKindSearch, json.RawMessage(`{"query":"  Alpha  Beta "}`))
	if err != nil || key != "alpha beta" {
		t.Fatalf("search key = %q, err = %v", key, err)
	}
	if string(payload) != `{"query":"Alpha  Beta"}` {
		t.Fatalf("search payload = %s", payload)
	}
}

func TestNormalizeSyncPayloadRejectsInvalid(t *testing.T) {
	cases := []struct {
		name string
		kind SyncKind
		raw  string
	}{
		{"missing payload", SyncKindWatch, ``},
		{"null payload", SyncKindSearch, `null`},
		{"blank title", SyncKindFavorite, `{"title":"   "}`},
		{"wrong type", SyncKindWatch, `{"title":1}`},
		{"negative index", SyncKindWatch, `{"title":"A","episode_index":-1}`},
		{"negative progress", SyncKindWatch, `{"title":"A","progress_sec":-1}`},
		{"long year", SyncKindFavorite, `{"title":"A","year":"` + strings.Repeat("9", 65) + `"}`},
		{"long desc", SyncKindFavorite, `{"title":"A","desc":"` + strings.Repeat("d", 2049) + `"}`},
		{"long query", SyncKindSearch, `{"query":"` + strings.Repeat("q", 513) + `"}`},
		{"unknown kind", SyncKind("bogus"), `{"title":"A"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := NormalizeSyncPayload(tc.kind, json.RawMessage(tc.raw)); err == nil {
				t.Fatalf("expected error for %s", tc.raw)
			}
		})
	}
}

func TestSyncKindValid(t *testing.T) {
	for _, k := range []SyncKind{SyncKindWatch, SyncKindFavorite, SyncKindSearch} {
		if !k.Valid() {
			t.Fatalf("%q should be valid", k)
		}
	}
	if SyncKind("history").Valid() {
		t.Fatal("unknown kind must be invalid")
	}
}
