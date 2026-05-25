package store

import (
	"testing"

	"github.com/mritd/kmtv/internal/consts"
)

func TestGetSetting(t *testing.T) {
	s := newTestStore(t)

	// Default settings should be populated by migrate().
	val, err := s.GetSetting("site_name")
	if err != nil {
		t.Fatalf("GetSetting error: %v", err)
	}
	if val != "KMTV" {
		t.Errorf("expected site_name=KMTV, got %q", val)
	}

	// Non-existent key returns empty string.
	val, err = s.GetSetting("nonexistent")
	if err != nil {
		t.Fatalf("GetSetting error for nonexistent key: %v", err)
	}
	if val != "" {
		t.Errorf("expected empty string for nonexistent key, got %q", val)
	}
}

func TestSetSetting(t *testing.T) {
	s := newTestStore(t)

	// Insert a new setting.
	if err := s.SetSetting("theme", "dark"); err != nil {
		t.Fatalf("SetSetting error: %v", err)
	}
	val, err := s.GetSetting("theme")
	if err != nil {
		t.Fatalf("GetSetting error: %v", err)
	}
	if val != "dark" {
		t.Errorf("expected theme=dark, got %q", val)
	}

	// Update an existing setting.
	if err := s.SetSetting("theme", "light"); err != nil {
		t.Fatalf("SetSetting update error: %v", err)
	}
	val, err = s.GetSetting("theme")
	if err != nil {
		t.Fatalf("GetSetting error after update: %v", err)
	}
	if val != "light" {
		t.Errorf("expected theme=light after update, got %q", val)
	}
}

func TestGetAllSettings(t *testing.T) {
	s := newTestStore(t)

	settings, err := s.GetAllSettings()
	if err != nil {
		t.Fatalf("GetAllSettings error: %v", err)
	}

	// Should have the default settings populated by migrations.
	if len(settings) == 0 {
		t.Fatal("expected default settings")
	}

	// Verify settings are ordered by key.
	for i := 1; i < len(settings); i++ {
		if settings[i].Key < settings[i-1].Key {
			t.Errorf("settings not ordered: %q before %q", settings[i-1].Key, settings[i].Key)
		}
	}

	// Verify default keys exist.
	expected := map[string]string{
		consts.SettingAnonymousAccess:     "true",
		consts.SettingHealthCheckInterval: "3600",
		consts.SettingNSFWFilterEnabled:   "true",
		consts.SettingSiteName:            "KMTV",
		consts.SettingPublicBaseURL:       "",
		consts.SettingAccessTokenTTL:      "604800",
		consts.SettingMediaTokenTTL:       "1800",
		consts.SettingPlaybackMode:        consts.PlaybackModeProxy,
	}
	found := make(map[string]string)
	for _, s := range settings {
		found[s.Key] = s.Value
	}
	for k, v := range expected {
		if found[k] != v {
			t.Errorf("expected %s=%s, got %q", k, v, found[k])
		}
	}
}
