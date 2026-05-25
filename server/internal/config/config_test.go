package config

import (
	"strings"
	"testing"

	"github.com/mritd/kmtv/internal/base58"
)

func TestParseSourceConfig(t *testing.T) {
	jsonData := `{
		"cache_time": 3600,
		"api_site": {
			"source-b.example": {
				"name": "Source B",
				"api": "https://source-b.example/api.php/provide/vod",
				"detail": "https://source-b.example",
				"_comment": "primary source"
			},
			"source-a.example": {
				"name": "Source A",
				"api": "https://source-a.example/api.php/provide/vod",
				"detail": "https://source-a.example",
				"_comment": "secondary source"
			}
		}
	}`

	cfg, err := ParseSourceConfig(strings.NewReader(jsonData))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.CacheTTL != 3600 {
		t.Errorf("CacheTTL = %d, want 3600", cfg.CacheTTL)
	}

	if len(cfg.Sources) != 2 {
		t.Fatalf("len(Sources) = %d, want 2", len(cfg.Sources))
	}

	// Sorted by key: source-a.example < source-b.example
	s0 := cfg.Sources[0]
	if s0.Key != "source-a.example" {
		t.Errorf("Sources[0].Key = %q, want %q", s0.Key, "source-a.example")
	}
	if s0.Name != "Source A" {
		t.Errorf("Sources[0].Name = %q, want %q", s0.Name, "Source A")
	}
	if s0.Comment != "secondary source" {
		t.Errorf("Sources[0].Comment = %q, want %q", s0.Comment, "secondary source")
	}

	s1 := cfg.Sources[1]
	if s1.Key != "source-b.example" {
		t.Errorf("Sources[1].Key = %q, want %q", s1.Key, "source-b.example")
	}
	if s1.Name != "Source B" {
		t.Errorf("Sources[1].Name = %q, want %q", s1.Name, "Source B")
	}
	if s1.Comment != "primary source" {
		t.Errorf("Sources[1].Comment = %q, want %q", s1.Comment, "primary source")
	}
}

func TestParseSourceConfig_Base58(t *testing.T) {
	original := `{"cache_time":100,"api_site":{"test.com":{"name":"Test","api":"https://test.com/api","detail":"https://test.com","_comment":"test"}}}`
	encoded := base58.Encode([]byte(original))

	cfg, err := ParseSourceConfig(strings.NewReader(encoded))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.Sources) != 1 {
		t.Fatalf("len(Sources) = %d, want 1", len(cfg.Sources))
	}
	if cfg.Sources[0].Key != "test.com" {
		t.Errorf("Sources[0].Key = %q, want %q", cfg.Sources[0].Key, "test.com")
	}
}

func TestParseSourceConfig_InvalidInputs(t *testing.T) {
	tests := []struct {
		name string
		data string
	}{
		{name: "invalid base58", data: "0OIl"},
		{name: "invalid json", data: `{"api_site":`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ParseSourceConfig(strings.NewReader(tt.data)); err == nil {
				t.Fatal("expected parse error")
			}
		})
	}
}

func TestParseEpisodes(t *testing.T) {
	raw := "第1集$http://example.com/1.m3u8#第2集$http://example.com/2.m3u8"

	eps := ParseEpisodes(raw)
	if len(eps) != 2 {
		t.Fatalf("len(episodes) = %d, want 2", len(eps))
	}

	if eps[0].Name != "第1集" || eps[0].URL != "http://example.com/1.m3u8" {
		t.Errorf("episodes[0] = %+v, want name=第1集 url=http://example.com/1.m3u8", eps[0])
	}
	if eps[1].Name != "第2集" || eps[1].URL != "http://example.com/2.m3u8" {
		t.Errorf("episodes[1] = %+v, want name=第2集 url=http://example.com/2.m3u8", eps[1])
	}
}

func TestParseEpisodes_MultiSource(t *testing.T) {
	raw := "第1集$http://a.com/1.m3u8#第2集$http://a.com/2.m3u8$$$第1集$http://b.com/1.m3u8#第2集$http://b.com/2.m3u8"

	// ParseEpisodes returns first group only.
	eps := ParseEpisodes(raw)
	if len(eps) != 2 {
		t.Fatalf("len(episodes) = %d, want 2", len(eps))
	}
	if eps[0].URL != "http://a.com/1.m3u8" {
		t.Errorf("episodes[0].URL = %q, want %q", eps[0].URL, "http://a.com/1.m3u8")
	}

	// ParseAllEpisodeGroups returns all groups.
	groups := ParseAllEpisodeGroups(raw)
	if len(groups) != 2 {
		t.Fatalf("len(groups) = %d, want 2", len(groups))
	}
	if len(groups[1]) != 2 {
		t.Fatalf("len(groups[1]) = %d, want 2", len(groups[1]))
	}
	if groups[1][0].URL != "http://b.com/1.m3u8" {
		t.Errorf("groups[1][0].URL = %q, want %q", groups[1][0].URL, "http://b.com/1.m3u8")
	}
}

func TestParseEpisodesSkipsInvalidEntries(t *testing.T) {
	if got := ParseEpisodes(""); got != nil {
		t.Fatalf("ParseEpisodes empty = %+v, want nil", got)
	}

	raw := "Page$https://example.com/watch#BadNoDollar#EP$https://example.com/video.mp4$$$OK$https://cdn.example.com/ok.m3u8"
	groups := ParseAllEpisodeGroups(raw)
	if len(groups) != 1 {
		t.Fatalf("len(groups) = %d, want 1", len(groups))
	}
	if groups[0][0].URL != "https://cdn.example.com/ok.m3u8" {
		t.Fatalf("unexpected parsed group: %+v", groups)
	}
}
